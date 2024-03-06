import HttpStatusCodes from '@src/constants/HttpStatusCodes';
import { IReq, IRes } from './types/express/misc';
import PingService from '@src/services/pingService/PingService';
import logger from 'jet-logger';
import { prisma } from '@src/util/db';

async function writeLogs(req: IReq<{ installId: string, logs: any }>, res: IRes) {
    await PingService.writeLogs(req.body.installId, req.body.logs);
    return res.status(HttpStatusCodes.OK).json({ message: 'Logs written successfully' });
}

async function getLatestCommand(req: IReq, res: IRes) {
    logger.info(`Checking commands for deploymentId ${req.params.deploymentId}`);
    const deploymentId = req.params.deploymentId;
    const response = await PingService.checkCommands(deploymentId);
    return res.status(HttpStatusCodes.OK).json(response);
}

type CommandData = {
    type: string;
    data: {
        [key: string]: unknown;
    };
    command: {
        ID: string;
        CreatedAt: string;
        CompletedAt: string | null;
        Type: string;
        Data: {
            version: string;
        };
        Status: string;
        TriggeredBy: string;
        DeploymentID: string;
    };
}

async function processCommand(req: IReq<{ installId: string, commandData: CommandData }>, res: IRes) {
    const commandData = req.body.commandData;
    if (!commandData) {
        return res.status(HttpStatusCodes.BAD_REQUEST).json("No command data provided");
    }

    if (commandData.type === "CHANGE_STATUS") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const newStatus = commandData.data.status as string;
        const agentCommand = commandData.command;

        // update command status
        await prisma.command.update({
            where: {
                id: agentCommand.ID,
            },
            data: {
                status: newStatus,
            },
        });

        return res.status(HttpStatusCodes.OK).json("Command processed successfully - updated status");
    }
}

export default {
    writeLogs,
    getLatestCommand,
    processCommand,
} as const;