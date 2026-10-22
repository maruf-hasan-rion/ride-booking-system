//query builder

import { Query } from "mongoose";
import {
  excludedFields,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_SORT_BY,
  DATE_SEARCH_FORMAT,
} from "../constants";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SENSITIVE_FIELDS = new Set(["password", "auths", "__v"]);

const isSafeFieldToken = (token: string) =>
  /^[+-]?[A-Za-z0-9_.]+$/.test(token) &&
  !SENSITIVE_FIELDS.has(token.replace(/^[+-]/, ""));

export class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public readonly query: Record<string, string>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, string>) {
    this.modelQuery = modelQuery;
    this.query = query;
  }

  private getPagination() {
    const rawPage = Number(this.query.page);
    const rawLimit = Number(this.query.limit);

    const page =
      Number.isFinite(rawPage) && rawPage >= 1
        ? Math.floor(rawPage)
        : DEFAULT_PAGE;
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    return { page, limit };
  }

  private addCondition(condition: Record<string, unknown>): this {
    if (Object.keys(condition).length === 0) {
      return this;
    }

    // Query.find() replaces the current conditions. Always merge with the
    // existing filter so a caller-supplied query cannot drop an ownership
    // scope such as Ride.find({ riderId }).
    const existing = this.modelQuery.getFilter() as Record<string, unknown>;
    const combined =
      Object.keys(existing).length > 0
        ? { $and: [existing, condition] }
        : condition;

    this.modelQuery = this.modelQuery.find(combined);
    return this;
  }

  filter(): this {
    const filter = { ...this.query };

    for (const field of excludedFields) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete filter[field];
    }

    for (const key of Object.keys(filter)) {
      if (
        key.startsWith("$") ||
        key.includes("__proto__") ||
        key.includes("constructor") ||
        key.includes("prototype")
      ) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete filter[key];
      }
    }

    return this.addCondition(filter);
  }

  search(searchableField: string[]): this {
    const searchTerm = (this.query.searchTerm || "").trim();
    if (!searchTerm) {
      return this;
    }

    const regex = escapeRegExp(searchTerm);
    return this.addCondition({
      $or: searchableField.map((field) => ({
        [field]: { $regex: regex, $options: "i" },
      })),
    });
  }

  dateSearch(dateField = "createdAt"): this {
    const dateSearch = this.query.dateSearch?.trim().slice(0, 32);
    if (!dateSearch) {
      return this;
    }

    const regex = escapeRegExp(dateSearch);
    return this.addCondition({
      $expr: {
        $regexMatch: {
          input: {
            $dateToString: { format: DATE_SEARCH_FORMAT, date: `$${dateField}` },
          },
          regex: regex,
        },
      },
    });
  }

  fareRange(): this {
    const rawMin = Number(this.query.minFare);
    const rawMax = Number(this.query.maxFare);
    const hasMin = this.query.minFare !== undefined && this.query.minFare !== "" && Number.isFinite(rawMin);
    const hasMax = this.query.maxFare !== undefined && this.query.maxFare !== "" && Number.isFinite(rawMax);

    if (!hasMin && !hasMax) {
      return this;
    }

    const fare: Record<string, number> = {};
    if (hasMin) fare.$gte = Math.max(0, rawMin);
    if (hasMax) fare.$lte = Math.max(0, rawMax);

    return this.addCondition({ fare });
  }

  sort(): this {
    const requested = this.query.sort || DEFAULT_SORT_BY;
    const tokens = requested
      .split(",")
      .map((token) => token.trim())
      .filter((token) => /^[+-]?[A-Za-z0-9_.]+$/.test(token));

    this.modelQuery = this.modelQuery.sort(
      tokens.length > 0 ? tokens.join(" ") : DEFAULT_SORT_BY,
    );

    return this;
  }

  fields(): this {
    const requested = this.query.fields;
    if (!requested) {
      return this;
    }

    const fields = requested
      .split(/[,\s]+/)
      .map((field) => field.trim())
      .filter((field) => field.length > 0 && isSafeFieldToken(field))
      .join(" ");

    if (fields) {
      this.modelQuery = this.modelQuery.select(fields);
    }

    return this;
  }

  paginate(): this {
    const { page, limit } = this.getPagination();
    const skip = (page - 1) * limit;

    this.modelQuery = this.modelQuery.skip(skip).limit(limit);

    return this;
  }

  build() {
    return this.modelQuery;
  }

  async getMeta() {
    // Count with the built filter/search applied, not the raw collection.
    const totalDocuments = await this.modelQuery.model.countDocuments(
      this.modelQuery.getFilter(),
    );

    const { page, limit } = this.getPagination();
    const totalPage = Math.max(1, Math.ceil(totalDocuments / limit));

    return { page, limit, total: totalDocuments, totalPage };
  }
}
