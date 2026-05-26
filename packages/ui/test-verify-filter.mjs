import { createColumnHelper, getCoreRowModel, getFilteredRowModel, useReactTable } from '@tanstack/react-table';

// Test if globalFilter works without globalFilterFn
const testData = [
  { name: 'Alice Smith', email: 'alice@example.com' },
  { name: 'Bob Jones', email: 'bob@example.com' },
];

const helper = createColumnHelper();
const columns = [
  helper.accessor('name', { header: 'Name' }),
  helper.accessor('email', { header: 'Email' }),
];

// Simulate what DataTable does
const table = useReactTable({
  data: testData,
  columns,
  state: { globalFilter: 'alice' },
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
});

console.log('Total rows:', testData.length);
console.log('Filtered rows:', table.getRowModel().rows.length);
console.log('Row IDs:', table.getRowModel().rows.map(r => r.original.name));
