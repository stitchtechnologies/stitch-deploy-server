import './pre-start'; // Must be the first import
import logger from 'jet-logger';

import EnvVars from '@src/constants/EnvVars';
import server from './server';
import { prisma } from './services/deployService/db';
import { updateStatus } from './services/deployService/DeployService';


// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' +
  EnvVars.Port.toString());

// TODO: move this to DeployService + using a proper messaging queue
const updateDeploymentStatuses = async () => {
  logger.info('Updating deployment statuses...');

  try {
    const deployments = await prisma.deployment.findMany({
      where: {
        status: {
          not: 'complete',
        },
      },
    });

    logger.info(`${deployments.length} deployment(s) to update`);

    await Promise.all(deployments.map(updateStatus));

    logger.info(`${deployments.length} deployment(s) updated`);
  } catch (error) {
    logger.err(error);
  }

  setTimeout(updateDeploymentStatuses, 5 * 1000);
};

server.listen(EnvVars.Port, () => {
  logger.info(SERVER_START_MSG);
  updateDeploymentStatuses();
});
