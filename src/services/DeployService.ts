/* eslint-disable max-len */
/* eslint-disable indent */
import {
    DescribeInstancesCommand,
    EC2Client,
    Instance,
    ResourceType,
    RunInstancesCommand,
    _InstanceType,
} from '@aws-sdk/client-ec2';
import { encode } from 'base-64';
import { v4 } from 'uuid';
import axios from 'axios';
import { PrismaClient, Service } from '@prisma/client';
import { ServicesEnvironmentVariables } from '@src/routes/DeploymentRoutes';
import { CdkTypescriptGithubDeploymentScript, DeploymentScript, DockerComposeDeploymentScript, DockerDeploymentScript, NextjsDeploymentScript } from '@src/models/deploy';
import fs, { readFileSync, mkdirSync } from 'fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import shell from 'shelljs';

type DeploymentMetadata = {
    id: string,
    awsInstanceId: string,
    status: 'deployed' | 'booting' | 'booted' | 'validating' | 'complete',
    url?: string
    publicDns?: string
    vendorId: string
    serviceId: string
    validationUrl: string | null
    userFriendlyUrl?: string;
}

type DeploymentKey = {
    accessKey: string,
    secretAccessKey: string
}

const AWS_REGION = 'us-east-1';

const prisma = new PrismaClient();

const deployments: Record<string, DeploymentMetadata> = {};
const deploymentKeys: Record<string, DeploymentKey> = {};

const getEc2Client = (id: string) => {
    const keys = deploymentKeys[id];
    if (!keys) {
        throw new Error('No keys found for this deployment');
    }

    return new EC2Client({
        region: AWS_REGION,
        credentials: {
            accessKeyId: keys.accessKey,
            secretAccessKey: keys.secretAccessKey,
        },
    });
};

function getInstancesOrThrow(instances?: Array<Instance | undefined>) {
    if (instances && instances.length !== 1) {
        throw new Error('Unexpected number of instances created');
    }

    const awsInstance = instances![0];
    if (!awsInstance) {
        throw new Error('InstanceId not defined');
    }

    return awsInstance;
}

async function getServiceEnvrionmentVariables(servicesEnvironmentVariables: ServicesEnvironmentVariables, serviceId: string) {
    const service = await prisma.service.findUnique({
        where: {
            id: serviceId,
        },
        include: {
            EnvironmentVariable: true,
        },
    });

    if (!service) {
        throw new Error(`Service ${serviceId} not found`);
    }

    const envVars = service.EnvironmentVariable.map(envVar => {
        return {
            // get the value from the request if it exists, otherwise use the value from the database - which is a default value which might not work or make sense!
            [envVar.key]: servicesEnvironmentVariables[serviceId] ? servicesEnvironmentVariables[serviceId][envVar.key] || envVar.value : envVar.value,
        };
    });

    console.log('envVars', envVars);

    return envVars;
}

function generateEnvFileScript(servicesEnvironmentVariables: Record<string, string>[]) {
    const keyValues = servicesEnvironmentVariables.flatMap(Object.entries).map(([key, value]) => `${key}="${value}"`).join('\n');
    return `cat << EOF > .env
${keyValues}
EOF
source .env`;
}

function combineScripts(mainScript: string, envScript: string) {
    let combinedScript = '';
    const hasHeader = mainScript.trim().startsWith('#!/bin/bash');
    if (hasHeader) {
        combinedScript += '#!/bin/bash\n';
    }
    combinedScript += envScript;
    combinedScript += '\n';

    if (hasHeader) {
        combinedScript += mainScript.replace('#!/bin/bash', '');
    }
    return combinedScript;
}

function generateDockerScript(dockerScript: DockerDeploymentScript | NextjsDeploymentScript) {
    let installDockerScript = readFileSync('./src/deploymentScripts/installDocker.sh', 'utf8');
    installDockerScript += '\n';
    if (dockerScript.portMappings.length <= 0) {
        installDockerScript += `docker run -d ${dockerScript.image}`;
        return installDockerScript;
    }

    const portMappings = dockerScript.portMappings.map(pm => `${pm.serverPort}:${pm.containerPort}`);
    installDockerScript += `docker run -d -p ${portMappings} ${dockerScript.image}`;
    return installDockerScript;
}

export function generateDockerComposeScript(dockerComposeScript: DockerComposeDeploymentScript) {
    let installDockerScript = readFileSync('./src/deploymentScripts/installDocker.sh', 'utf8');
    installDockerScript += '\n';
    installDockerScript += 'mkdir stitch && cd stitch';
    installDockerScript += '\n';

    installDockerScript += `cat << EOF > docker-compose.yml
${dockerComposeScript.composeFile}
EOF`;

    installDockerScript += '\n';
    installDockerScript += 'sudo docker-compose up -d';

    return installDockerScript;
}

function generateV2Script(service: Service) {
    const deploymentScript = service.scriptV2 as DeploymentScript;
    switch (deploymentScript.type) {
        case 'docker':
        case 'next-js':
            return generateDockerScript(deploymentScript);
        case 'shell':
            return deploymentScript.script;
        case 'docker-compose':
            return generateDockerComposeScript(deploymentScript);
    }
    throw new Error('script not defined');
}

function generateUserDataScript(service: Service) {
    if (service.scriptV2) {
        return generateV2Script(service);
    }

    return service.script.trim();
}

export async function deployCdk(deploymentId: string, script: CdkTypescriptGithubDeploymentScript) {
    const dir = `./installs/${deploymentId}`;
    mkdirSync(dir);
    await git.clone({
        fs, http, dir, url: script.repoUrl, onAuth: (url) => {
            return {
                username: script.auth?.username,
                password: script.auth?.accessToken,
            };
        },
    });
    shell.cd(dir);
    shell.exec('npm install');
    const synthCommand = shell.exec('cdk deploy --require-approval never');
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
        deployCdk(deploymentId, scriptV2);
        return;
    }

    // TODO we are currently assuming there is only one service and one script per organization
    const script = generateUserDataScript(service);
    const envVars = await getServiceEnvrionmentVariables(servicesEnvironmentVariables, service.id);
    const envFileScript = generateEnvFileScript(envVars);
    const finalScript = combineScripts(script, envFileScript);
    const base64Script = encode(finalScript);

    const params = {
        ImageId: 'ami-0e731c8a588258d0d',
        InstanceType: 't2.medium' as _InstanceType,
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