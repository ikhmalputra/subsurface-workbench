"use client";

import { useId, useState, type SyntheticEvent } from "react";
import { CommandButton } from "./ui.js";

export interface AccessibleTableColumn {
  readonly label: string;
  readonly unit?: string;
}

export interface AccessibleTableProps {
  readonly label: string;
  readonly description: string;
  readonly columns: readonly AccessibleTableColumn[];
  readonly rowCount: number;
  readonly getRows: (start: number, end: number) => readonly (readonly (string | number | null)[])[];
  readonly pageSize?: number;
}

export interface AccessibleTableRowGroup {
  readonly rowCount: number;
  readonly getRow: (index: number) => readonly (string | number | null)[];
}

export function getAccessibleRowsPage(groups: readonly AccessibleTableRowGroup[], start: number, end: number) {
  const rows: (readonly (string | number | null)[])[] = [];
  let offset = 0;
  for (const group of groups) {
    const groupStart = Math.max(0, start - offset);
    const groupEnd = Math.min(group.rowCount, end - offset);
    for (let index = groupStart; index < groupEnd; index++) rows.push(group.getRow(index));
    offset += group.rowCount;
    if (offset >= end) break;
  }
  return rows;
}

export function AccessibleTable({
  label,
  description,
  columns,
  rowCount,
  getRows,
  pageSize = 50,
}: AccessibleTableProps) {
  const [rows, setRows] = useState<readonly (readonly (string | number | null)[])[] | null>(null);
  const [page, setPage] = useState(0);
  const descriptionId = useId();
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RangeError("Accessible table page size must be a positive safe integer.");

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const open = event.currentTarget.open;
    if (open && rows === null) setRows(getRows(0, Math.min(rowCount, pageSize)));
    if (!open) { setPage(0); setRows(null); }
  }

  function changePage(nextPage: number) {
    const boundedPage = Math.max(0, Math.min(totalPages - 1, nextPage));
    setPage(boundedPage);
    setRows(getRows(boundedPage * pageSize, Math.min(rowCount, (boundedPage + 1) * pageSize)));
  }

  const totalPages = Math.max(1, Math.ceil(rowCount / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const visibleRows = rows ?? [];
  return <details className="sw-accessible-table" onToggle={onToggle}>
    <summary>View {label} as a table ({rowCount.toLocaleString()} rows)</summary>
    <p id={descriptionId}>{description}</p>
    {rows && <>
      <div className="sw-accessible-table-controls">
        <CommandButton icon="previous" type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Previous rows</CommandButton>
        <span aria-live="polite">Rows {rowCount ? start + 1 : 0}–{Math.min(rowCount, start + visibleRows.length)} of {rowCount.toLocaleString()}</span>
        <CommandButton icon="next" type="button" disabled={currentPage + 1 >= totalPages} onClick={() => changePage(currentPage + 1)}>Next rows</CommandButton>
      </div>
      <div className="sw-accessible-table-scroll" tabIndex={0} role="region" aria-label={`${label} data`}>
        <table aria-describedby={descriptionId}>
          <caption>{label}</caption>
          <thead><tr>{columns.map((column) => <th key={column.label} scope="col">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row, index) => <tr key={start + index}>{columns.map((column, columnIndex) => {
            const value = row[columnIndex];
            return <td key={column.label}>{value === null || value === undefined ? "not reported" : value}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </>}
  </details>;
}
