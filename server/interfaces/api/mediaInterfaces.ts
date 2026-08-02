import type Media from '@server/entity/Media';
import type { PaginatedResponse } from './common';

export interface MediaResultsResponse extends PaginatedResponse {
  results: Media[];
}
