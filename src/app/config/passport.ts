/* eslint-disable @typescript-eslint/no-explicit-any */
import bcryptjs from "bcryptjs";
import passport from "passport";
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import { AccountStatus, IAuthProvider } from "../modules/user/user.interface";
import { canLinkGoogleAccount } from "../utils/accountLinking";
import { User } from "../modules/user/user.model";
import { envVars } from "./env";

passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email: string, password: string, done) => {
      try {
        const isUserExist = await User.findOne({ email }).select("+password");

        if (!isUserExist) {
          return done("User does not exist");
        }

        if (!isUserExist?.isVerified) {
          return done("User is not verified");
        }
        if (
          isUserExist.isBlocked ||
          isUserExist.status === AccountStatus.BLOCKED
        ) {
          return done("User is blocked");
        }
        if (isUserExist.status === AccountStatus.SUSPENDED) {
          return done("User is suspended");
        }

        const isGoogleAuthenticated = isUserExist.auths.some(
          (providerObjects: IAuthProvider) =>
            providerObjects.provider == "google",
        );

        if (isGoogleAuthenticated && !isUserExist.password) {
          return done(null, false, {
            message:
              "You have authenticated through Google. So if you want to login with credentials, then at first login with google and set a password for your Gmail and then you can login with email and password.",
          });
        }

        const isPasswordMatched = await bcryptjs.compare(
          password as string,
          isUserExist.password as string
        );

        if (!isPasswordMatched) {
          return done(null, false, { message: "Password does not match" });
        }
        return done(null, isUserExist);
      } catch (error) {
        done(error);
      }
    }
  )
);

if (
  envVars.GOOGLE_CLIENT_ID &&
  envVars.GOOGLE_CLIENT_SECRET &&
  envVars.GOOGLE_CALLBACK_URL
) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: envVars.GOOGLE_CLIENT_ID,
        clientSecret: envVars.GOOGLE_CLIENT_SECRET,
        callbackURL: envVars.GOOGLE_CALLBACK_URL,
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        try {
          const email = profile.emails?.[0].value;

        if (!email) {
          return done(null, false, { mesaage: "No email found" });
        }

        let user = await User.findOne({ email });

        if (
          user &&
          (user.isBlocked || user.status === AccountStatus.BLOCKED)
        ) {
          return done(null, false, { message: "User is blocked" });
        }

        if (user && user.status === AccountStatus.SUSPENDED) {
          return done(null, false, { message: "User is suspended" });
        }

        if (user && !canLinkGoogleAccount(user)) {
          return done(null, false, {
            message:
              "This email already has an unverified password account. Verify the email before linking Google.",
          });
        }

        if (!user) {
          user = await User.create({
            email,
            name: profile.displayName,
            isVerified: true,
            isBlocked: false,
            status: AccountStatus.ACTIVE,
            auths: [
              {
                provider: "google",
                providerId: profile.id,
              },
            ],
          });
        } else {
          const hasGoogleProvider = user.auths.some(
            (providerObjects: IAuthProvider) =>
              providerObjects.provider === "google",
          );

          let shouldSave = false;

          if (!hasGoogleProvider) {
            user.auths.push({
              provider: "google",
              providerId: profile.id,
            });
            shouldSave = true;
          }

          if (!user.isVerified) {
            user.isVerified = true;
            shouldSave = true;
          }

          if (!user.name && profile.displayName) {
            user.name = profile.displayName;
            shouldSave = true;
          }

          if (!user.status) {
            user.status = AccountStatus.ACTIVE;
            shouldSave = true;
          }

          if (shouldSave) {
            await user.save();
          }
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
      }
    )
  );
}

passport.serializeUser((user: any, done: (err: any, id?: unknown) => void) => {
  done(null, user._id);
});

passport.deserializeUser(async (id: string, done: any) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

