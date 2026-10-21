//query builder

import { Query } from "mongoose";
import { excludedFields, DEFAULT_PAGE, DEFAULT_LIMIT, DEFAULT_SORT_BY, DATE_SEARCH_FORMAT } from "../constants";

export class QueryBuilder<T> {
  public modelQuery: Query<T[], T>;
  public readonly query: Record<string, string>;

  constructor(modelQuery: Query<T[], T>, query: Record<string, string>) {
    this.modelQuery = modelQuery;
    this.query = query;
  }
  filter(): this {
    const filter = { ...this.query };

    for (const field of excludedFields) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete filter[field];
    }

    this.modelQuery = this.modelQuery.find(filter);

    return this;
  }

  search(searchableField: string[]): this {
    const searchTerm = this.query.searchTerm || "";
    const searchQuery = {
      $or: searchableField.map((field) => ({
        [field]: { $regex: searchTerm, $options: "i" },
      })),
    };
    this.modelQuery = this.modelQuery.find(searchQuery);
    return this;
  }

  dateSearch(dateField = "createdAt"): this {
    const dateSearch = this.query.dateSearch?.trim();
    if (dateSearch) {
      const regex = new RegExp(dateSearch, "i");
      this.modelQuery = this.modelQuery.find({
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
    return this;
  }

  sort(): this {
    const sort = this.query.sort || DEFAULT_SORT_BY;

    this.modelQuery = this.modelQuery.sort(sort);

    return this;
  }
  fields(): this {
    const fields = this.query.fields?.split(",").join(" ") || "";

    this.modelQuery = this.modelQuery.select(fields);

    return this;
  }
  paginate(): this {
    const page = Number(this.query.page) || DEFAULT_PAGE;
    const limit = Number(this.query.limit) || DEFAULT_LIMIT;
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

    const page = Number(this.query.page) || DEFAULT_PAGE;
    const limit = Number(this.query.limit) || DEFAULT_LIMIT;

    const totalPage = Math.max(1, Math.ceil(totalDocuments / limit));

    return { page, limit, total: totalDocuments, totalPage };
  }
}
