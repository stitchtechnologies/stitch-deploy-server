import { EC2Client, Instance } from '@aws-sdk/client-ec2';
import { deploymentKeys } from './DeployService';
import { AWS_REGION, ServicesEnvironmentVariables } from './types';
import { prisma } from './db';

export const getEc2Client = (id: string) => {
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

export function getInstancesOrThrow(instances?: Array<Instance | undefined>) {
    if (instances && instances.length !== 1) {
        throw new Error('Unexpected number of instances created');
    }

    const awsInstance = instances![0];
    if (!awsInstance) {
        throw new Error('InstanceId not defined');
    }

    return awsInstance;
}

export async function getServiceEnvrionmentVariables(servicesEnvironmentVariables: ServicesEnvironmentVariables, serviceId: string) {
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
            [envVar.key]: servicesEnvironmentVariables[serviceId] ?
                servicesEnvironmentVariables[serviceId][envVar.key] || envVar.value
                : envVar.value,
        };
    });

    return envVars;
}