import {
    DescribeInstancesCommand,
    ResourceType,
    RunInstancesCommand,
} from '@aws-sdk/client-ec2';
import { encode } from 'base-64';
import { v4 } from 'uuid';
import axios from 'axios';
import { DeploymentKey, IMAGE_ID, INSTANCE_TYPE, ServicesEnvironmentVariables } from './types';
import { prisma } from './db';
import { getDeployment, getDeploymentKey, getEc2Client, getInstancesOrThrow, getServiceEnvrionmentVariables, updateDeploymentStatus } from './utils';
import { combineScripts, deployCdk, generateEnvFileScript, generateUserDataScript } from './script-utils';
import { DeploymentScript } from '@src/models/deploy';
import { Deployment } from '@prisma/client';

async function Deploy(vendorId: string, serviceId: string, servicesEnvironmentVariables: ServicesEnvironmentVariables, keys: DeploymentKey) {
    const service = await prisma.service.findUnique({
        where: {
            id: serviceId,
            vendorId: vendorId,
        },
        include: {
            EnvironmentVariable: true,
        },
    });

    if (!service) {
        throw new Error(`Service ${serviceId} (vendor: ${vendorId}) not found`);
    }

    const deploymentId = v4();

    const scriptV2 = service.scriptV2 as DeploymentScript | undefined;
    if (scriptV2 && scriptV2.type === 'cdk-ts-github') {
        await prisma.deployment.create({
            data: {
                id: deploymentId,
                status: 'deployed',
                awsInstanceId: "",
                url: "",
                publicDns: "",
                validationUrl: service.validationUrl,
                userFriendlyUrl: "",
                deploymentKey: keys,
                Service: {
                    connect: {
                        id: serviceId,
                    },
                },
                Vendor: {
                    connect: {
                        id: vendorId,
                    },
                },
            },
        });

        deployCdk(deploymentId, keys, scriptV2).then(async () => {
            await updateDeploymentStatus(deploymentId, 'complete');
        });

        const deployment = await getDeployment(deploymentId);

        return deployment;
    }

    // TODO we are currently assuming there is only one service and one script per organization
    const script = generateUserDataScript(service);
    const envVars = await getServiceEnvrionmentVariables(servicesEnvironmentVariables, service.id);
    const envFileScript = generateEnvFileScript(envVars);
    const finalScript = combineScripts(script, envFileScript);
    const base64Script = encode(finalScript);

    const params = {
        ImageId: IMAGE_ID,
        InstanceType: INSTANCE_TYPE,
        MinCount: 1,
        MaxCount: 1,
        UserData: base64Script,
        TagSpecifications: [
            {
                ResourceType: ResourceType.instance,
                Tags: [
                    {
                        Key: 'Name',
                        Value: `${service.title} ${new Date().toISOString()}`,
                    },
                ],
            },
        ],
    };

    try {
        const ec2Client = getEc2Client(keys.accessKey, keys.secretAccessKey);
        const data = await ec2Client.send(new RunInstancesCommand(params));

        const awsInstanceId = getInstancesOrThrow(data.Instances).InstanceId;
        if (!awsInstanceId) {
            throw new Error('AWS instance id not defined');
        }

        const deployment = await prisma.deployment.create({
            data: {
                id: deploymentId,
                status: 'deployed',
                awsInstanceId,
                validationUrl: service.validationUrl,
                deploymentKey: keys,
                Service: {
                    connect: {
                        id: serviceId,
                    },
                },
                Vendor: {
                    connect: {
                        id: vendorId,
                    },
                },
            },
        });

        // record the install in the database
        await prisma.install.create({
            data: {
                id: deploymentId,
                status: 'deployed',
                Service: {
                    connect: {
                        id: serviceId,
                    },
                },
            },
        });

        return deployment;
    } catch (err) {
        console.error('error', err);
    }
}

async function Status(id: string) {
    const deployment = await getDeployment(id);

    switch (deployment.status) {
        case 'deployed':
        case 'booting':
            await tryGetPublicDns(deployment);
            break;
        case 'booted':
        case 'validating':
            await tryValidateService(deployment);
            break;
    }

    return deployment;
}

async function tryGetPublicDns(deployment: Deployment) {
    await updateDeploymentStatus(deployment.id, 'booting');
    await prisma.install.update({
        where: {
            id: deployment.id,
        },
        data: {
            status: 'booting',
        },
    });
    const deploymentKey = await getDeploymentKey(deployment.id);
    const ec2Client = getEc2Client(deploymentKey.accessKey, deploymentKey.secretAccessKey);
    const data = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: [deployment.awsInstanceId],
    }));

    const instance = getInstancesOrThrow(data.Reservations?.flatMap(reservation => reservation.Instances));
    const publicDnsName = instance.PublicDnsName;
    if (!publicDnsName) {
        return;
    }

    const service = await prisma.service.findUnique({
        where: {
            id: deployment.serviceId,
        },
    });
    const { port } = service!;
    const newUrl = `http://${publicDnsName}${port ? ':' + port : ''}`;
    const newPublicDns = publicDnsName;
    let newUserFriendlyUrl = deployment.url;
    if (deployment.validationUrl) {
        newUserFriendlyUrl = deployment.validationUrl.replace('{{HOSTNAME}}', newPublicDns);
        await updateDeploymentStatus(deployment.id, 'booted');
        await prisma.install.update({
            where: {
                id: deployment.id,
            },
            data: {
                status: 'booted',
            },
        });
    } else {
        // if validation url is not go straight to complete
        await updateDeploymentStatus(deployment.id, 'complete');
        await prisma.install.update({
            where: {
                id: deployment.id,
            },
            data: {
                status: 'complete',
            },
        });
    }
    await prisma.deployment.update({
        where: {
            id: deployment.id,
        },
        data: {
            url: newUrl,
            publicDns: newPublicDns,
            userFriendlyUrl: newUserFriendlyUrl,
        },
    });
}

async function tryValidateService(deployment: Deployment) {
    try {
        let url = deployment.url;
        if (deployment.validationUrl != null && deployment.validationUrl != '') {
            url = deployment.validationUrl.replace('{{HOSTNAME}}', deployment.publicDns!);
        }
        console.log('url ping', url);
        const response = await axios.get(url!);
        console.log('response', response);
        if ((response.status - 200) < 100) {
            await updateDeploymentStatus(deployment.id, 'complete');
            await prisma.install.update({
                where: {
                    id: deployment.id,
                },
                data: {
                    status: 'complete',
                },
            });
        }
    } catch {
        // frontend will retry
    }
}

export default {
    Deploy,
    Status,
} as const;