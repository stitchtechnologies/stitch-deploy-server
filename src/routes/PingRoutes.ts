import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import PingService from '@src/services/PingService';

function agentPing(req: IReq<{ time: string, url: string, logs: any, installId: string }>, res: IRes) {
    PingService.writeLogs(req.body.installId, req.body.logs);
    const response = PingService.ping(req.body.time, req.body.url);
    return res.status(HttpStatusCodes.OK).json(response);
}

export default {
    agentPing,
} as const;