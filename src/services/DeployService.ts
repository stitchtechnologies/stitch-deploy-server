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
import { PrismaClient } from '@prisma/client';
import { ServicesEnvironmentVariables } from '@src/routes/DeploymentRoutes';

type DeploymentMetadata = {
    id: string,
    awsInstanceId: string,
    status: 'deployed' | 'booting' | 'booted' | 'validating' | 'complete',
    url?: string
    vendorId: string
    serviceId: string
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
    const script = service.script.trim();
    const envVars = await getServiceEnvrionmentVariables(servicesEnvironmentVariables, service.id);
    console.log("servicesEnvironmentVariables", service.title, envVars);
    console.log(script);
    const base64Script = encode(script);
    console.log(base64Script);

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
        console.log('data', data);

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
    console.log('tryGetPublicDns', deployment);

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
    deployment.status = 'booted';
}

async function tryValidateService(deployment: DeploymentMetadata) {
    console.log('tryValidateService', deployment);
    try {
        const response = await axios.get(deployment.url!);
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