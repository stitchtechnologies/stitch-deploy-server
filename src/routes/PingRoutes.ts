import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import PingService from '@src/services/pingService/PingService';

async function agentPing(req: IReq<{ time: string, url: string, logs: any, installId: string }>, res: IRes) {
    PingService.writeLogs(req.body.installId, req.body.logs);
    const response = await PingService.checkCommands(req.body.installId);
    return res.status(HttpStatusCodes.OK).json(response);
}

export default {
    agentPing,
} as const;