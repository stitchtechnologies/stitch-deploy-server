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
import { DeploymentScript, DockerComposeDeploymentScript, DockerDeploymentScript } from '@src/models/deploy';
import { readFileSync } from "fs";
import convertToDockerRunCommands from "decomposerize";

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
            [envVar.key]: servicesEnvironmentVariables[serviceId][envVar.key] || envVar.value,
        };
    });

    return envVars;
}

function generateEnvFileScript(servicesEnvironmentVariables: Record<string, string>[]) {
    const keyValues = servicesEnvironmentVariables.flatMap(Object.entries).map(([key, value]) => `${key}="${value}"`).join("\n");
    return `cat << EOF > .env
${keyValues}
EOF
source .env`;
}

function combineScripts(mainScript: string, envScript: string) {
    let combinedScript = "";
    const hasHeader = mainScript.trim().startsWith("#!/bin/bash");
    if (hasHeader) {
        combinedScript += "#!/bin/bash\n";
    }
    combinedScript += envScript;
    combinedScript += "\n";

    if (hasHeader) {
        combinedScript += mainScript.replace("#!/bin/bash", "");
    }
    return combinedScript;
}

function generateDockerScript(dockerScript: DockerDeploymentScript) {
    let installDockerScript = readFileSync("./src/deploymentScripts/installDocker.sh", "utf8")
    installDockerScript += "\n";
    if (dockerScript.portMappings.length <= 0) {
        installDockerScript += `docker run -d ${dockerScript.image}`;
        return installDockerScript;
    }

    const portMappings = dockerScript.portMappings.map(pm => `${pm.serverPort}:${pm.containerPort}`);
    installDockerScript += `docker run -d -p ${portMappings} ${dockerScript.image}`;
    return installDockerScript;
}

export function generateDockerComposeScript(dockerComposeScript: DockerComposeDeploymentScript) {
    let installDockerScript = readFileSync("./src/deploymentScripts/installDocker.sh", "utf8")
    installDockerScript += "\n";
    installDockerScript += "mkdir stitch && cd stitch";
    installDockerScript += "\n";

    installDockerScript += `cat << EOF > docker-compose.yml
${dockerComposeScript.composeFile}
EOF`

    installDockerScript += "\n";
    installDockerScript += "sudo docker-compose up -d";

    return installDockerScript;
}

function generateV2Script(service: Service) {
    const deploymentScript = service.scriptV2 as DeploymentScript;
    switch (deploymentScript.type) {
        case 'docker':
            return generateDockerScript(deploymentScript);
        case 'shell':
            return deploymentScript.script;
        case 'docker-compose':
            return generateDockerComposeScript(deploymentScript);
    }
    throw new Error("script not defined");
}

function generateUserDataScript(service: Service) {
    if (service.scriptV2) {
        return generateV2Script(service);
    }

    return service.script.trim();
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

    // TODO we are currently assuming there is only one service and one script per organization
    const script = generateUserDataScript(service);
    console.log("script", script);
    const envVars = await getServiceEnvrionmentVariables(servicesEnvironmentVariables, service.id);
    const envFileScript = generateEnvFileScript(envVars)
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
        const id = v4();
        deploymentKeys[id] = { ...keys };
        const ec2Client = getEc2Client(id);
        const data = await ec2Client.send(new RunInstancesCommand(params));

        const awsInstanceId = getInstancesOrThrow(data.Instances).InstanceId;
        if (!awsInstanceId) {
            throw new Error('AWS instance id not defined');
        }

        deployments[id] = {
            id,
            status: 'deployed',
            awsInstanceId,
            vendorId,
            serviceId,
            validationUrl: service.validationUrl
        };
        return deployments[id];
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
        }
    });
    const { port } = service!;
    deployment.url = `http://${publicDnsName}${port ? ':' + port : ''}`;
    deployment.publicDns = publicDnsName;

    deployment.userFriendlyUrl = deployment.url;
    if (deployment.validationUrl) {
        deployment.userFriendlyUrl = deployment.validationUrl.replace("{{HOSTNAME}}", deployment.publicDns!);
        deployment.status = 'booted';
        return;
    }
    // if validation url is not go straight to complete
    deployment.status = 'complete';
}

async function tryValidateService(deployment: DeploymentMetadata) {
    try {
        let url = deployment.url;
        if (deployment.validationUrl) {
            url = deployment.validationUrl.replace("{{HOSTNAME}}", deployment.publicDns!)
        }
        console.log("url ping", url);
        const response = await axios.get(url!);
        console.log("response", response);
        if ((response.status - 200) < 100) {
            deployment.status = 'complete';
        }
    } catch {
        // frontend will retry
    }
}

export default {
    Deploy,
    Status,
} as const;