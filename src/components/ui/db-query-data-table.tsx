import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

export interface DbQueryTableColumn<T> {
  key: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  className?: string;
}

export interface DbQueryTablePagination {
  currentPage: number;
  totalPages: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export interface DbQueryDataTableProps<T> {
  title?: string;
  data: T[];
  columns: DbQueryTableColumn<T>[];
  loading?: boolean;
  pagination?: DbQueryTablePagination;
  emptyMessage?: string;
  className?: string;
  caption?: string;
  getRowKey?: (row: T, index: number) => string;
}

function clampPage(page: number, total: number) {
  if (total <= 0) return 1;
  return Math.min(Math.max(page, 1), total);
}

export function DbQueryDataTable<T>({
  title,
  data,
  columns,
  loading = false,
  pagination,
  emptyMessage,
  className,
  caption,
  getRowKey,
}: DbQueryDataTableProps<T>) {
  const { t } = useLocale();
  const resolvedTitle = title ?? t.DbQuery.table.title;
  const resolvedEmpty = emptyMessage ?? t.DbQuery.table.noData;

  const currentPage = pagination ? clampPage(pagination.currentPage, pagination.totalPages) : 1;
  const totalPages = pagination?.totalPages ?? 1;
  const isPaginated = Boolean(pagination);

  const handlePageChange = (page: number) => {
    if (!pagination) return;
    const nextPage = clampPage(page, pagination.totalPages);
    if (nextPage !== pagination.currentPage) {
      pagination.onPageChange(nextPage);
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base font-semibold">{resolvedTitle}</CardTitle>
        {isPaginated && (
          <div className="text-xs text-muted-foreground">
            {t.DbQuery.table.pageOf(currentPage, totalPages)}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground">{resolvedEmpty}</div>
        ) : (
          <Table>
            {caption ? <TableCaption>{caption}</TableCaption> : null}
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} className={column.className}>
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, index) => (
                <TableRow key={getRowKey ? getRowKey(row, index) : `row-${index}`}>
                  {columns.map((column) => (
                    <TableCell key={`${column.key}-${index}`} className={column.className}>
                      {column.accessor(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {isPaginated && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="text-xs text-muted-foreground">
              {pagination?.pageSize
                ? `${t.DbQuery.table.rowsPerPage}: ${pagination.pageSize}`
                : t.DbQuery.table.rowsPerPage}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(1)}
                disabled={currentPage <= 1}
                className={cn('h-8 px-2')}
              >
                {t.DbQuery.table.firstPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className={cn('h-8 px-2')}
              >
                {t.DbQuery.table.previousPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className={cn('h-8 px-2')}
              >
                {t.DbQuery.table.nextPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage >= totalPages}
                className={cn('h-8 px-2')}
              >
                {t.DbQuery.table.lastPage}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
