import express, { Application, Request, Response } from "express";
import expressSession from "express-session";
import { envVars } from "./app/config/env";
import passport from "passport";
import "./app/config/passport";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { router } from "./app/routes";
import { globalErrorHandler } from "./app/middlewares/globalErrorHandler";
import notFound from "./app/middlewares/notFound";

const app: Application = express();

app.use(helmet());

app.use(
  expressSession({
    secret: envVars.EXPRESS_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use(cookieParser());
app.use(express.json());
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: [envVars.FRONTEND_URL, "http://localhost:5173"],
    credentials: true,
  }),
);

app.use("/api/v1", router);

app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    message: "Welcome to the GoMove API",
  });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
