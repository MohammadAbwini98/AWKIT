export interface JsonArrayDataSourceProfile {
  id: string;
  name: string;
  type: "jsonArray";
  file: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
  rowCount?: number;
  sampleRow?: unknown;
}
