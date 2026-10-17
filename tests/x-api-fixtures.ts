// Synthetic API responses only. No credentials, account data, or requests to X.
export function apiResponse(ids = ['1', '3']) {
  return { data: ids.map(id => ({ id, author_id: '100', text: `API synthetic post ${id} with longer text https://t.co/synthetic`, created_at: '2026-10-01T12:00:00.000Z',
    attachments: { media_keys: ['3_photo', '7_video'] }, entities: { urls: [{ url: 'https://t.co/synthetic', expanded_url: 'https://example.com/article', title: 'Synthetic article', images: [{ url: 'https://pbs.twimg.com/card_img/api-card.jpg' }] }] },
    referenced_tweets: [{ type: 'quoted', id: '10' }] })),
    includes: { users: [{ id: '100', username: 'synthetic', name: 'Synthetic author' }, { id: '200', username: 'quoted', name: 'Quoted author' }],
      media: [{ media_key: '3_photo', type: 'photo', url: 'https://pbs.twimg.com/media/api-photo.jpg' }, { media_key: '7_video', type: 'video', preview_image_url: 'https://pbs.twimg.com/ext_tw_video_thumb/api-video.jpg' }],
      tweets: [{ id: '10', author_id: '200', text: 'Synthetic quoted text', created_at: '2026-09-01T00:00:00Z', attachments: { media_keys: [] } }] },
    meta: { result_count: ids.length, next_token: 'synthetic-next-page' } };
}
