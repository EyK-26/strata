import type { Statistics } from "../../types/statistics";

function toStatisticsResource(statistics: Statistics): Statistics {
  return {
    ...statistics,
  };
}

export { toStatisticsResource };
