type PageAfterDeletionInput = {
  currentPage: number;
  totalCount: number;
  deletedCount: number;
  pageSize: number;
};

export function pageAfterDeletion({
  currentPage,
  totalCount,
  deletedCount,
  pageSize,
}: PageAfterDeletionInput) {
  const remainingCount = Math.max(0, totalCount - deletedCount);
  const remainingPages = Math.max(1, Math.ceil(remainingCount / Math.max(1, pageSize)));
  return Math.max(1, Math.min(currentPage, remainingPages));
}
