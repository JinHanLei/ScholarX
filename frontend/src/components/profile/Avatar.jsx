import React from 'react';
import { User } from 'lucide-react';

function Avatar({ user, size = 38 }) {
  const avatarUrl = user?.user_metadata?.avatar_url;
  return (
    <span className="user-avatar" style={{ width: size, height: size }}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : <User size={Math.max(16, size / 2.2)} />}
    </span>
  );
}

export { Avatar };
