import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slidesRouter from "./slides";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/slides", slidesRouter);

export default router;
