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

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Cookie-authenticated mutations must carry a header that a cross-site HTML
// form cannot set. Bearer-token clients are not CSRF-exposed.
app.use((req: Request, res: Response, next) => {
  const usesCookieAuth = Boolean(
    req.cookies?.accessToken || req.cookies?.refreshToken,
  );

  if (!mutatingMethods.has(req.method) || !usesCookieAuth) {
    next();
    return;
  }

  if (req.get("X-Requested-With") === "XMLHttpRequest") {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    message: "Missing CSRF protection header.",
  });
});

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
