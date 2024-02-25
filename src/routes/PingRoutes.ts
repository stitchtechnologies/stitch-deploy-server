import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import PingService from '@src/services/PingService';

function agentPing(req: IReq<{ time: string, url: string }>, res: IRes) {
    const response = PingService.ping(req.body.time, req.body.url);
    return res.status(HttpStatusCodes.OK).json(response);
}

export default {
    agentPing,
} as const;