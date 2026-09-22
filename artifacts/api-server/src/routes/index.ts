import { Router, type IRouter } from "express";
import healthRouter from "./health";
import discoverRouter from "./discover";

const router: IRouter = Router();

router.use(healthRouter);
router.use(discoverRouter);

export default router;
