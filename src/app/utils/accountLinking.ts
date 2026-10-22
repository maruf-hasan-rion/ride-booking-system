import { IAuthProvider } from "../modules/user/user.interface";

/**
 * Google may only be attached automatically to an account that has already
 * proven ownership of the email (verified) or that already has Google linked.
 * An unverified credentials account could have been pre-registered by someone
 * else, so linking it silently would let that person keep password access.
 */
export const canLinkGoogleAccount = (user: {
  isVerified?: boolean;
  auths?: IAuthProvider[];
}): boolean => {
  if (user.isVerified) {
    return true;
  }

  return Boolean(
    user.auths?.some((provider) => provider.provider === "google"),
  );
};
