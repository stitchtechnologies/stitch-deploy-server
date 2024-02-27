import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import DeployService from '@src/services/deployService/DeployService';
import { ServicesEnvironmentVariables } from '@src/services/deployService/types';

async function startDeployment(req: IReq<{
    vendorId: string,
    serviceId: string,
    accessKey: string,
    secret: string,
    servicesEnvironmentVariables: ServicesEnvironmentVariables,
    accountNumber?: string,
    awsRegion?: string
}>, res: IRes) {
    const response = await DeployService.Deploy(req.body.vendorId, req.body.serviceId, req.body.servicesEnvironmentVariables, {
        accessKey: req.body.accessKey,
        secretAccessKey: req.body.secret,
        awsRegion: req.body.awsRegion,
        accountNumber: req.body.accountNumber
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