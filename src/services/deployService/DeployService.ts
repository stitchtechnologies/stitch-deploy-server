import {
    DescribeImagesCommand,
    DescribeInstancesCommand,
    ResourceType,
    RunInstancesCommand,
    RunInstancesCommandInput,
} from '@aws-sdk/client-ec2';
import { encode } from 'base-64';
import { v4 } from 'uuid';
import axios from 'axios';
import { DeploymentKey, InstanceSettings, ServicesEnvironmentVariables } from './types';
import { prisma } from './db';
import { getDeployment, getDeploymentKey, getEc2Client, getInstancesOrThrow, getServiceEnvrionmentVariables, sendEmail, updateDeploymentStatus } from './utils';
import { combineScripts, deployCdk, generateEnvFileScript, generateUserDataScript } from './script-utils';
import { DeploymentScript } from '@src/models/deploy';
import { Deployment } from '@prisma/client';
import logger from 'jet-logger';

async function Deploy(vendorId: string, serviceId: string, servicesEnvironmentVariables: ServicesEnvironmentVariables, keys: DeploymentKey, email?: string) {
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
                email,
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
    const finalScript = combineScripts(script, envFileScript, deploymentId);
    const base64Script = encode(finalScript);

    const instanceSettings: InstanceSettings = service.instanceSettings as InstanceSettings || {
        operatingSystem: 'ami-0440d3b780d96b29d',
        instanceType: 't2.medium',
        storageVolumeSize: 8,
    };

    try {
        const ec2Client = getEc2Client(keys.accessKey, keys.secretAccessKey);

        const describeImagesCommand = new DescribeImagesCommand({ ImageIds: [instanceSettings.operatingSystem] });
        const imageDescription = await ec2Client.send(describeImagesCommand);
        if (!imageDescription.Images || imageDescription.Images.length === 0) {
            throw new Error(`Image ${instanceSettings.operatingSystem} not found`);
        }

        const params: RunInstancesCommandInput = {
            ImageId: instanceSettings.operatingSystem,
            InstanceType: instanceSettings.instanceType,
            BlockDeviceMappings: [
                {
                    DeviceName: imageDescription.Images[0].RootDeviceName,
                    Ebs: {
                        VolumeSize: instanceSettings.storageVolumeSize,
                    },
                },
            ],
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
                email,
            },
        });

        return deployment;
    } catch (err) {
        console.error('error', err);
    }
}

async function Status(id: string) {
    const deployment = await getDeployment(id);
    const deploymentStatus = await updateStatus(deployment);
    return deploymentStatus;
}

async function checkInstanceIsRunning(deployment: Deployment) {
    const deploymentKey = await getDeploymentKey(deployment.id);
    const ec2Client = getEc2Client(deploymentKey.accessKey, deploymentKey.secretAccessKey);
    const data = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: [deployment.awsInstanceId],
    }));
    const instance = getInstancesOrThrow(data.Reservations?.flatMap(reservation => reservation.Instances));
    if (instance.State?.Name === 'running') {
        return true;
    }
    return false;
}

export async function updateStatus(deployment: Deployment) {
    const deploymentInstanceIsRunning = await checkInstanceIsRunning(deployment);

    if (!deploymentInstanceIsRunning) {
        logger.warn(`Instance for deployment ${deployment.id} is not running`);
        return deployment;
    }

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

    return await getDeployment(deployment.id);
}

async function tryGetPublicDns(deployment: Deployment) {
    await updateDeploymentStatus(deployment.id, 'booting');
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
    } else {
        // if validation url is not go straight to complete
        await updateDeploymentStatus(deployment.id, 'complete');
        await sendEmail(deployment);
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
        logger.info(`Pinging ${url} for ${deployment.id}`);
        const response = await axios.get(url!);
        if (response.status < 300) {
            await updateDeploymentStatus(deployment.id, 'complete');
            await sendEmail(deployment);
        }
    } catch {
        // frontend will retry
    }
}

export default {
    Deploy,
    Status,
} as const;