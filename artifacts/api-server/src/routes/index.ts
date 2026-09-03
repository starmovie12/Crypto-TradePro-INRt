import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradeproRouter from "./tradepro";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradeproRouter);

export default router;
