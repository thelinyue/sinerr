import { type RTRating } from '@server/api/rating/rottentomatoes';

export interface RatingResponse {
  rt?: RTRating;
  imdb?: {
    criticsRating?: string;
    criticsScore: number;
    criticsScoreCount: number;
    url: string;
  };
}
