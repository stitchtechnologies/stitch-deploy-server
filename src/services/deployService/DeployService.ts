import {
    DescribeInstancesCommand,
    ResourceType,
    RunInstancesCommand,
} from '@aws-sdk/client-ec2';
import { encode } from 'base-64';
import { v4 } from 'uuid';
import axios from 'axios';
import { CdkTypescriptGithubDeploymentScript, DeploymentScript } from '@src/models/deploy';
import fs, { mkdirSync } from 'fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import shell from 'shelljs';
import { DeploymentKey, DeploymentMetadata, IMAGE_ID, INSTANCE_TYPE, ServicesEnvironmentVariables } from './types';
import { prisma } from './db';
import { getEc2Client, getInstancesOrThrow, getServiceEnvrionmentVariables } from './utils';
import { combineScripts, generateEnvFileScript, generateUserDataScript } from './script-utils';

export const deployments: Record<string, DeploymentMetadata> = {};
export const deploymentKeys: Record<string, DeploymentKey> = {};

async function deployCdk(deploymentId: string, keys: DeploymentKey, script: CdkTypescriptGithubDeploymentScript) {
    if (!keys.accountNumber || !keys.awsRegion) {
        throw new Error("AWS region and account number are required for CDK deployments");
    }
    const dir = `./installs/${deploymentId}`;
    mkdirSync(dir);
    await git.clone({
        fs, http, dir, url: script.repoUrl, onAuth: () => {
            return {
                username: script.auth?.username,
                password: script.auth?.accessToken,
            };
        },
    });
    shell.env["AWS_ACCESS_KEY_ID"] = keys.accessKey;
    shell.env["AWS_SECRET_ACCESS_KEY"] = keys.secretAccessKey;
    shell.env["AWS_DEFAULT_REGION"] = keys.awsRegion ?? "us-east-1";
    shell.cd(dir);
    shell.exec("npm install");
    shell.exec(`cdk bootstrap aws://${keys.accountNumber}/${keys.awsRegion} --require-approval never`);
    shell.exec("cdk deploy --require-approval never");
}

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
        deployments[deploymentId] = {
            id: deploymentId,
            status: 'deployed',
            awsInstanceId: "",
            vendorId,
            serviceId,
            validationUrl: service.validationUrl,
        };

        deployCdk(deploymentId, keys, scriptV2).then(() => {
            deployments[deploymentId].status = 'complete';
        });

        return deployments[deploymentId];
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
        deploymentKeys[deploymentId] = { ...keys };
        const ec2Client = getEc2Client(deploymentId);
        const data = await ec2Client.send(new RunInstancesCommand(params));

        const awsInstanceId = getInstancesOrThrow(data.Instances).InstanceId;
        if (!awsInstanceId) {
            throw new Error('AWS instance id not defined');
        }

        deployments[deploymentId] = {
            id: deploymentId,
            status: 'deployed',
            awsInstanceId,
            vendorId,
            serviceId,
            validationUrl: service.validationUrl,
        };

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

        return deployments[deploymentId];
    } catch (err) {
        console.error('error', err);
    }
}


async function Status(id: string) {
    const deployment = deployments[id];
    if (!deployment) {
        throw new Error(`Couldn't find deployment ${id}`);
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

    return deployment;
}

async function tryGetPublicDns(deployment: DeploymentMetadata) {
    deployment.status = 'booting';
    await prisma.install.update({
        where: {
            id: deployment.id,
        },
        data: {
            status: 'booting',
        },
    });
    const ec2Client = getEc2Client(deployment.id);
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
    deployment.url = `http://${publicDnsName}${port ? ':' + port : ''}`;
    deployment.publicDns = publicDnsName;

    deployment.userFriendlyUrl = deployment.url;
    if (deployment.validationUrl) {
        deployment.userFriendlyUrl = deployment.validationUrl.replace('{{HOSTNAME}}', deployment.publicDns);
        deployment.status = 'booted';
        await prisma.install.update({
            where: {
                id: deployment.id,
            },
            data: {
                status: 'booted',
            },
        });
        return;
    }
    // if validation url is not go straight to complete
    deployment.status = 'complete';
    await prisma.install.update({
        where: {
            id: deployment.id,
        },
        data: {
            status: 'complete',
        },
    });
}

async function tryValidateService(deployment: DeploymentMetadata) {
    try {
        let url = deployment.url;
        if (deployment.validationUrl != null && deployment.validationUrl != '') {
            url = deployment.validationUrl.replace('{{HOSTNAME}}', deployment.publicDns!);
        }
        console.log('url ping', url);
        const response = await axios.get(url!);
        console.log('response', response);
        if ((response.status - 200) < 100) {
            deployment.status = 'complete';
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