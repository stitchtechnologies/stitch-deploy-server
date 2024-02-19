import { DescribeInstancesCommand, EC2Client, Instance, ReservationState, RunInstancesCommand, _InstanceType } from "@aws-sdk/client-ec2";
import { readFileSync } from 'fs';
import { encode } from 'base-64';
import EnvVars from '@src/constants/EnvVars';
import { v4 } from "uuid"
import axios from "axios";

type DeploymentMetadata = {
    id: string,
    awsInstanceId: string,
    status: "deployed" | "booting" | "booted" | "validating" | "complete",
    url?: string
}

const AWS_REGION = "us-east-1";

type DeploymentKey = {
    accessKey: string,
    secretAccessKey: string
}

const deployments: Record<string, DeploymentMetadata> = {}
const deploymentKeys: Record<string, DeploymentKey> = {}

const getEc2Client = (id: string) => {
    const keys = deploymentKeys[id]
    if (!keys) {
        throw new Error("No keys found for this deployment")
    }

    return new EC2Client({
        region: AWS_REGION,
        credentials: {
            accessKeyId: keys.accessKey,
            secretAccessKey: keys.secretAccessKey
        }
    });
}

function getInstancesOrThrow(instances?: Array<Instance | undefined>) {
    if (instances && instances.length !== 1) {
        throw new Error("Unexpected number of instances created");
    }

    const awsInstance = instances![0];
    if (!awsInstance) {
        throw new Error("InstanceId not defined");
    }

    return awsInstance;
}

async function Deploy(keys: DeploymentKey) {
    const script = readFileSync('./src/deploymentScripts/langfuse.sh', 'utf-8');
    const base64Script = encode(script);

    const params = {
        ImageId: "ami-0e731c8a588258d0d",
        InstanceType: "t2.medium" as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: base64Script
    };

    try {
        const id = v4()
        deploymentKeys[id] = { ...keys }
        const ec2Client = getEc2Client(id)
        const data = await ec2Client.send(new RunInstancesCommand(params));
        console.log("data", data);

        const awsInstanceId = getInstancesOrThrow(data.Instances).InstanceId;
        if (!awsInstanceId) {
            throw new Error("AWS instance id not defined");
        }

        deployments[id] = {
            id,
            status: "deployed",
            awsInstanceId
        }
        return deployments[id];
    } catch (err) {
        console.error("error", err);
    }
}


async function Status(id: string) {
    const deployment = deployments[id];
    if (!deployment) {
        throw new Error(`Couldn't find deployment ${id}`);
    }

    switch (deployment.status) {
        case "deployed":
        case "booting":
            tryGetPublicDns(deployment);
            break;

        case "booted":
        case "validating":
            tryValidateService(deployment)
            break;
    }

    return deployment;
}

async function tryGetPublicDns(deployment: DeploymentMetadata) {
    console.log("tryGetPublicDns", deployment)

    deployment.status = "booting"
    const ec2Client = getEc2Client(deployment.id)
    const data = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: [deployment.awsInstanceId]
    }));

    const instance = getInstancesOrThrow(data.Reservations?.flatMap(reservation => reservation.Instances))
    const publicDnsName = instance.PublicDnsName;
    if (!publicDnsName) {
        return;
    }

    deployment.url = `http://${publicDnsName}:3000`;
    deployment.status = "booted"
}

async function tryValidateService(deployment: DeploymentMetadata) {
    console.log("tryValidateService", deployment)
    try {
        const response = await axios.get(deployment.url!)
        if ((response.status - 200) < 100) {
            deployment.status = "complete";
        }
    } catch {
        // frontend will retry
    }
}

export default {
    Deploy,
    Status
} as const