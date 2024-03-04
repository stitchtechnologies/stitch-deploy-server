import { _InstanceType } from "@aws-sdk/client-ec2";

export type DeploymentKey = {
    accessKey: string,
    secretAccessKey: string,
    accountNumber?: string,
    awsRegion?: string
};

export type ServicesEnvironmentVariables = {
    [serviceId: string]: {
        [key: string]: string
    }
};

export const AWS_REGION = 'us-east-1';

export type InstanceSettings = {
    operatingSystem: string,
    instanceType: _InstanceType,
    storageVolumeSize: number
}