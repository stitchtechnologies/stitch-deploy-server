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

type DeploymentMetadata = {
    id: string,
    awsInstanceId: string,
    status: 'deployed' | 'booting' | 'booted' | 'validating' | 'complete',
    url?: string
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

async function Deploy(organizationId: string, keys: DeploymentKey) {
    const organization = await prisma.organization.findUnique({
        where: {
            id: organizationId,
        },
        include: {
            Service: {
                include: {
                    EnvironmentVariable: true,
                },
            },
        },
    });

    if (!organization) {
        throw new Error(`Organization ${organizationId} not found`);
    }

    // TODO we are currently assuming there is only one service and one script per organization
    const script = organization.Service[0].script.trim();
    console.log(script)
    const base64Script = encode(script);
    console.log(base64Script)

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
                        Value: `${organization.Service[0].title} ${new Date().toISOString()}`,
                    }
                ]
            }
        ]
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

    deployment.url = `http://${publicDnsName}:3000`;
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