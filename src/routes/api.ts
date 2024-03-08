import { Router } from 'express';
import jetValidator from 'jet-validator';

import Paths from '../constants/Paths';
import User from '@src/models/User';
import UserRoutes from './UserRoutes';
import DeploymentRoutes from './DeploymentRoutes';
import PingRoutes from './PingRoutes';


// **** Variables **** //

const apiRouter = Router(),
  validate = jetValidator();


// ** Add UserRouter ** //

const userRouter = Router();

// Get all users
userRouter.get(
  Paths.Users.Get,
  UserRoutes.getAll,
);

// Add one user
userRouter.post(
  Paths.Users.Add,
  validate(['user', User.isUser]),
  UserRoutes.add,
);

// Update one user
userRouter.put(
  Paths.Users.Update,
  validate(['user', User.isUser]),
  UserRoutes.update,
);

// Delete one user
userRouter.delete(
  Paths.Users.Delete,
  validate(['id', 'number', 'params']),
  UserRoutes.delete,
);

// Add UserRouter
apiRouter.use(Paths.Users.Base, userRouter);

const deployRouter = Router();

deployRouter.get(
  Paths.Deploy.Status,
  DeploymentRoutes.getDeploymentStatus,
);

deployRouter.post(
  Paths.Deploy.Start,
  DeploymentRoutes.startDeployment,
);

apiRouter.use(Paths.Deploy.Base, deployRouter);


const pingRouter = Router();

pingRouter.post(
  Paths.Ping.SendStatus,
  PingRoutes.sendStatus,
);

pingRouter.post(
  Paths.Ping.WriteLogs,
  PingRoutes.writeLogs,
);

pingRouter.get(
  Paths.Ping.GetLatestCommand,
  PingRoutes.getLatestCommand,
);

pingRouter.post(
  Paths.Ping.ProcessCommand,
  PingRoutes.processCommand,
);

apiRouter.use(Paths.Ping.Base, pingRouter);

// **** Export default **** //

export default apiRouter;
