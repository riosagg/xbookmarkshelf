import { viewerText, type ViewerMessage, type ViewerLanguage } from './viewer-messages';
import type { MarkSymbol } from './model';
const symbols: Record<MarkSymbol, readonly [string, string]> = {
  star: ['スター', 'Star'], flag: ['旗', 'Flag'], heart: ['ハート', 'Heart'], bolt: ['稲妻', 'Lightning'], book: ['本', 'Book'], bulb: ['電球', 'Light bulb'],
  code: ['コード', 'Code'], check: ['チェック', 'Check'], pin: ['ピン', 'Pin'], bookmark: ['しおり', 'Bookmark'], folder: ['フォルダー', 'Folder'], briefcase: ['仕事', 'Work'],
  home: ['家', 'Home'], globe: ['地球', 'Globe'], link: ['リンク', 'Link'], music: ['音楽', 'Music'], film: ['映画', 'Film'], camera: ['カメラ', 'Camera'], headphones: ['ヘッドホン', 'Headphones'],
  palette: ['パレット', 'Palette'], flask: ['実験', 'Experiment'], graduation: ['学習', 'Study'], terminal: ['ターミナル', 'Terminal'], bug: ['バグ', 'Bug'], shield: ['盾', 'Shield'],
  clock: ['時計', 'Clock'], calendar: ['カレンダー', 'Calendar'], coffee: ['コーヒー', 'Coffee'], rocket: ['ロケット', 'Rocket'], archive: ['保管箱', 'Archive'],
};
export const localSymbolText = (symbol: MarkSymbol, language: ViewerLanguage) => symbols[symbol][language === 'ja' ? 0 : 1];
export const localMessages = {
  loadingPosts: ['投稿を読み込んでいます…', 'Loading posts…'],
  splitExport: ['分割ファイルをすべて保存してください。取り込み時はまとめて選択します。', 'Save every part. Select all parts together when importing.'],
  partsError: ['分割バックアップは、同じ書き出しの全ファイルをまとめて選択してください。', 'Select all parts from the same backup export together.'],
  resume: ['開く', 'Open'], otherFile: ['別のファイル', 'Choose another file'], forget: ['選択の記憶を消す', 'Forget selected file'],
  rememberedFile: ['再開するファイル', 'File to reopen'], memoryError: ['このブラウザでは選択を記憶できません。', 'This browser could not remember your selection.'],
  resumeError: ['ファイルを開けません。移動・削除や内容を確認してください。', 'Could not reopen the file. Check its location and contents.'],
  permissionError: ['ファイルへのアクセスが許可されませんでした。', 'File access was not granted.'],
  previewNote: ['ONにするとpbs.twimg.comから画像を読み込みます。', 'Loads images from pbs.twimg.com when enabled.'],
  localTitle: ['ローカルライブラリ', 'Local library'], bookmarks: ['ブックマーク', 'Bookmarks'], likes: ['いいね', 'Likes'],
  welcome: ['管理JSONを開くか新しく作成してください。Xのlike.jsや拡張の投稿バックアップを追加できます。', 'Open or create a library JSON. Add X like.js files or extension posts backups.'],
  new: ['新しく作る', 'Create library'], openLibrary: ['管理JSONを開く', 'Open library JSON'], import: ['追加取り込み', 'Add import'],
  save: ['保存', 'Save'], saveAs: ['名前を付けて保存', 'Save as'], saved: ['保存済み', 'Saved'], unsaved: ['未保存の変更があります', 'Unsaved changes'],
  newFile: ['保存先を選んでください', 'Choose a save location'], fileStorage: ['データはファイルに保存', 'Data is saved in your file'],
  saveNote: ['変更後は「保存」を押してください。', 'Click Save after making changes.'],
  discard: ['未保存の変更があります。変更を破棄して続けますか？', 'There are unsaved changes. Discard them and continue?'],
  working: ['処理中…', 'Working…'], backupPage: ['バックアップ・取り込み', 'Backup and import'], settingsPage: ['設定', 'Settings'],
  backupScope: ['バックアップの範囲', 'Backup scope'], entire: ['全体（ブックマーク＋いいね）', 'Entire library (bookmarks + likes)'], current: ['現在のライブラリ', 'Current library'],
  localBackup: ['管理JSONをバックアップ', 'Back up library JSON'], extensionBackup: ['拡張用の投稿JSONを出力', 'Export posts JSON for extension'],
  extensionNote: ['拡張用JSONはブックマークのみ対応。', 'Extension JSON supports bookmarks only.'],
  importNote: ['投稿JSON・like.js・管理JSONに対応。既存の仕分けと設定は保持します。', 'Supports posts JSON, like.js, and library JSON. Keeps existing organization and settings.'],
  imported: ['取り込み完了', 'Import complete'], added: ['新規', 'Added'], existing: ['既存・重複', 'Existing / duplicate'],
  formatError: ['対応する管理JSONではありません。元のアーカイブは「追加取り込み」から選んでください。', 'Unsupported library JSON. Use Add import for an archive or posts backup.'],
  sizeError: ['管理JSONは512MiB、元のlike.js・投稿JSONは20MiBまでです。', 'Library JSON supports up to 512 MiB; source like.js and posts JSON up to 20 MiB.'],
  recordsError: ['形式・件数・URL・分類の関連が不正です。データは変更していません。', 'Invalid format, count, URL or classification relationship. Your data has not changed.'],
  marksError: ['マークはアカウントごとに30個までです。名前の重複やアイコンも確認してください。', 'Up to 30 marks per account. Check duplicate names and the icon.'],
  tagsError: ['タグ・マークは投稿ごとに合計20個までです。名前は1〜100文字にしてください。', 'Up to 20 tags and marks per post. Names must be 1–100 characters.'],
  emptyError: ['対象のマークや投稿がありません。範囲を選び直してください。', 'The selected mark or posts are unavailable. Choose the scope again.'],
  conflictError: ['保存先が別の操作で変更されました。上書きを止めました。「名前を付けて保存」で別ファイルへ保存してください。', 'The file was changed elsewhere. Overwriting was stopped. Use Save as to keep your changes in another file.'],
  saveError: ['保存できませんでした。変更は画面内に残っています。権限や空き容量を確認して再試行してください。', 'Could not save. Your changes remain on screen. Check permission or free space and retry.'],
  dismissNotice: ['通知を閉じる', 'Dismiss notification'],
  downloaded: ['管理JSONをダウンロードしました。ファイルの保存を確認してください。', 'Library JSON downloaded. Check that the file was saved.'],
  limits: ['合計200,000件・管理JSON 512MiBまで', 'Up to 200,000 posts total · Library JSON 512 MiB'],
  total: ['保存する投稿数', 'Total posts'], fileSize: ['保存ファイルの容量', 'Saved file size'], notSaved: ['まだ保存していません', 'Not saved yet'],
  allBookmarks: ['すべてのブックマーク', 'All bookmarks'], allLikes: ['すべてのいいね', 'All likes'],
  unknownMedia: ['メディア未取得', 'Media not retrieved'], idDate: ['投稿IDから算出した日時', 'Date derived from post ID'],
  likesInfo: ['投稿者・画像は未取得。日時は投稿IDから算出した投稿日です。', 'Authors and images are unavailable. Dates are posting dates derived from post IDs.'],
  from: ['投稿日（開始）', 'Posted from'], to: ['投稿日（終了）', 'Posted to'],
  manageMarks: ['マークを管理', 'Manage marks'], markAccount: ['マークを管理するアカウント', 'Account for marks'],
  likesAccount: ['いいねアーカイブ', 'Likes archive'], markName: ['マークの名前', 'Mark name'], markIcon: ['マークのアイコン', 'Mark icon'],
  createMark: ['マークを登録', 'Create mark'], editMark: ['マークを編集', 'Edit mark'], saveMark: ['マークを保存', 'Save mark'],
  edit: ['編集', 'Edit'], demote: ['タグに戻す', 'Convert to tag'], up: ['上へ', 'Move up'], down: ['下へ', 'Move down'], cancel: ['キャンセル', 'Cancel'],
  markLimit: ['上限30個。上下ボタンで並べ替え。', 'Up to 30 marks. Reorder with the arrows.'],
  noAccount: ['ブックマークを取り込むとマークを登録できます。', 'Import bookmarks to create marks.'],
  moreMarks: ['その他のマーク', 'More marks'], selectMark: ['マークを選択', 'Choose marks'], searchMarks: ['マーク名で検索', 'Search marks'],
  markSuffix: ['のマーク', ' mark'], toggleHint: ['クリックで付与・解除', 'Click to assign or remove'],
  makeUnread: ['未読に戻す', 'Mark unread'], makeRead: ['既読にする', 'Mark read'],
} as const;
export type LocalMessage = keyof typeof localMessages;
export type LocalTranslate = (key: LocalMessage | ViewerMessage) => string;
export function localText(key: LocalMessage | ViewerMessage, language: ViewerLanguage): string {
  if (key in localMessages) return localMessages[key as LocalMessage][language === 'ja' ? 0 : 1];
  return viewerText(key as ViewerMessage, language);
}
