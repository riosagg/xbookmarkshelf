import { downloadBackupFile, type BackupFile } from './backup-parts';
export function BackupDownloads({ files, label }: { files: BackupFile[]; label: string }) {
  return files.length > 1 ? <section class="panel backup-parts" aria-label={label}><p>{label}</p>
    <ul>{files.map(file => <li key={file.name}><button onClick={() => downloadBackupFile(file)}>{file.name}</button></li>)}</ul>
  </section> : null;
}
