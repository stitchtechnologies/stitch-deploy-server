import { _InstanceType } from "@aws-sdk/client-ec2"

export type DeploymentMetadata = {
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

export type DeploymentKey = {
    accessKey: string,
    secretAccessKey: string,
    accountNumber?: string,
    awsRegion?: string
}

export type ServicesEnvironmentVariables = {
    [serviceId: string]: {
        [key: string]: string
    }
};

export const AWS_REGION = 'us-east-1';

export const IMAGE_ID = 'ami-0e731c8a588258d0d';

export const INSTANCE_TYPE = 't2.medium' as _InstanceType;