import type Database from "better-sqlite3";

interface FileEdgeRow {
  file_a: number;
  file_b: number;
  edge_count: number;
}

const MAX_CLUSTER_SIZE = 30;

function buildUnionFind(size: number): { parent: number[]; rank: number[] } {
  const parent = Array.from({ length: size }, (_, i) => i);
  const rank = new Array(size).fill(0);
  return { parent, rank };
}

function find(parent: number[], x: number): number {
  if (parent[x] !== x) parent[x] = find(parent, parent[x]!);
  return parent[x]!;
}

function union(parent: number[], rank: number[], x: number, y: number): void {
  const rootX = find(parent, x);
  const rootY = find(parent, y);
  if (rootX === rootY) return;
  if (rank[rootX]! < rank[rootY]!) {
    parent[rootX] = rootY;
  } else if (rank[rootX]! > rank[rootY]!) {
    parent[rootY] = rootX;
  } else {
    parent[rootY] = rootX;
    rank[rootX]!++;
  }
}

export function computeClusters(db: Database.Database, projectRoot?: string): void {
  db.prepare("DELETE FROM file_clusters").run();

  const allFileRows = db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
  if (allFileRows.length === 0) return;

  const fileIds = allFileRows.map((f) => f.id);
  const filePathById = new Map(allFileRows.map((f) => [f.id, f.path]));
  const indexMap = new Map(fileIds.map((id, i) => [id, i]));

  const { parent, rank } = buildUnionFind(fileIds.length);

  const edgeGroups: Array<{ kinds: string[]; threshold: number }> = [
    { kinds: ["import"], threshold: 1 },
    { kinds: ["inheritance", "implements"], threshold: 1 },
    { kinds: ["call"], threshold: 2 },
    { kinds: ["type_usage"], threshold: 3 },
  ];

  for (const { kinds, threshold } of edgeGroups) {
    // Use parameterized queries to prevent SQL injection
    const kindPlaceholders = kinds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT
        MIN(sf.file_id, tf.file_id) as file_a,
        MAX(sf.file_id, tf.file_id) as file_b,
        COUNT(*) as edge_count
      FROM edges e
      JOIN symbols sf ON sf.id = e.source_symbol_id
      JOIN symbols tf ON tf.id = e.target_symbol_id
      WHERE sf.file_id != tf.file_id
        AND e.kind IN (${kindPlaceholders})
      GROUP BY file_a, file_b
      HAVING edge_count >= ?
    `).all(...kinds, threshold) as FileEdgeRow[];

    for (const edge of rows) {
      const i = indexMap.get(edge.file_a);
      const j = indexMap.get(edge.file_b);
      if (i !== undefined && j !== undefined) {
        union(parent, rank, i, j);
      }
    }
  }

  const clusterGroups = new Map<number, number[]>();
  for (let i = 0; i < fileIds.length; i++) {
    const root = find(parent, i);
    const group = clusterGroups.get(root) ?? [];
    group.push(fileIds[i]!);
    clusterGroups.set(root, group);
  }

  const insert = db.prepare("INSERT INTO file_clusters (file_id, cluster_id) VALUES (?, ?)");
  let clusterId = 1;

  const insertAll = db.transaction(() => {
    for (const group of clusterGroups.values()) {
      if (group.length <= MAX_CLUSTER_SIZE) {
        for (const fileId of group) {
          insert.run(fileId, clusterId);
        }
        clusterId++;
      } else {
        const byDir = new Map<string, number[]>();
        for (const fileId of group) {
          const absolutePath = filePathById.get(fileId) ?? "";
          const relPath =
            projectRoot && absolutePath.startsWith(projectRoot)
              ? absolutePath.slice(projectRoot.length).replace(/^[/\\]/, "")
              : absolutePath;
          // Take first 2 directory segments from the project-relative path (exclude filename)
          const parts = relPath.split(/[/\\]/);
          const dir = parts.slice(0, -1).slice(0, 2).join("/");
          const dirGroup = byDir.get(dir) ?? [];
          dirGroup.push(fileId);
          byDir.set(dir, dirGroup);
        }
        for (const dirGroup of byDir.values()) {
          for (const fileId of dirGroup) {
            insert.run(fileId, clusterId);
          }
          clusterId++;
        }
      }
    }
  });

  insertAll();
}

export function backfillClustersIfNeeded(db: Database.Database, projectRoot?: string): boolean {
  const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
  if (fileCount === 0) return false;

  const clusterCount = (db.prepare("SELECT COUNT(*) as c FROM file_clusters").get() as { c: number }).c;
  if (clusterCount > 0) return false;

  computeClusters(db, projectRoot);
  return true;
}

export function getClusterFileIds(db: Database.Database, clusterId: number): number[] {
  const rows = db.prepare("SELECT file_id FROM file_clusters WHERE cluster_id = ?").all(clusterId) as Array<{ file_id: number }>;
  return rows.map((r) => r.file_id);
}

export function getFileClusterId(db: Database.Database, fileId: number): number | null {
  const row = db.prepare("SELECT cluster_id FROM file_clusters WHERE file_id = ?").get(fileId) as { cluster_id: number } | undefined;
  return row?.cluster_id ?? null;
}
