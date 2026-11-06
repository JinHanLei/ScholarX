function hasUserMessages(chat) {
  return (chat.messages || []).some((message) => message.role === 'user');
}

function mergeChatTrace(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((item) => {
    const key = `${item.stage || ''}|${item.title || ''}|${item.detail || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chatLibraryId(chat) {
  return chat?.libraryId ?? null;
}

function chatBelongsToLibrary(chat, libraryId) {
  return chatLibraryId(chat) === (libraryId ?? null);
}

export { chatBelongsToLibrary, chatLibraryId, hasUserMessages, mergeChatTrace };
