import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import DeployService from '@src/services/DeployService';

export type ServiceEnvironmentVariables = {
    [serviceId: string]: {
        [key: string]: string
    }
};

async function startDeployment(req: IReq<{ organizationId: string, accessKey: string, secret: string, serviceEnvironmentVariables: ServiceEnvironmentVariables }>, res: IRes) {
    const response = await DeployService.Deploy(req.body.organizationId, req.body.serviceEnvironmentVariables, {
        accessKey: req.body.accessKey,
        secretAccessKey: req.body.secret,
    });
    return res.status(HttpStatusCodes.OK).json(response);
}

async function getDeploymentStatus(req: IReq, res: IRes) {
    const response = await DeployService.Status(req.params.id);
    return res.status(HttpStatusCodes.OK).json(response);
}

export default {
    startDeployment,
    getDeploymentStatus
} as const;