import { EC2Client, Instance } from '@aws-sdk/client-ec2';
import { AWS_REGION, ServicesEnvironmentVariables } from './types';
import { prisma } from './db';
import { JsonObject } from '@prisma/client/runtime/library';

export const updateDeploymentStatus = async (id: string, status: string) => {
    const deployment = await prisma.deployment.update({
        where: {
            id,
        },
        data: {
            status,
        },
    });
    return deployment;
};

export const getDeployment = async (id: string) => {
    const deployment = await prisma.deployment.findUnique({
        where: {
            id,
        },
    });

    if (!deployment) {
        throw new Error('Deployment not found');
    }

    return deployment;
};

export const getDeploymentKey = async (deploymentId: string) => {
    const deployment = await getDeployment(deploymentId);
    const deploymentKey = deployment.deploymentKey as JsonObject;

    return {
        accessKey: deploymentKey.accessKey as string,
        secretAccessKey: deploymentKey.secretAccessKey as string,
        accountNumber: deploymentKey.accountNumber as string,
        awsRegion: deploymentKey.awsRegion as string,
    };
};

export const getEc2Client = (accessKeyId: string, secretAccessKey: string) => {
    return new EC2Client({
        region: AWS_REGION,
        credentials: {
            accessKeyId,
            secretAccessKey,
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