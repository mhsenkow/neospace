/**
 * NeoSpace Mock Data Composable
 * 
 * Provides mock data for development and testing.
 * The custom_css field contains user-defined CSS variables
 * that will be injected when Chaos Mode is activated.
 */

export interface MockUser {
  id: string
  username: string
  displayName: string
  avatar: string
  header: string
  bio: string
  followersCount: number
  followingCount: number
  postsCount: number
  customCSS: string // The Myspace-era magic ✨
}

export interface MockPost {
  id: string
  author: MockUser
  content: string
  createdAt: string
  reblogsCount: number
  favouritesCount: number
  repliesCount: number
  mediaAttachments: string[]
}

/**
 * Retro Chaos CSS Theme
 * This is what peak personal expression looked like in 2006
 */
const RETRO_CHAOS_CSS = `
/* ============================================
   🌀 CHAOS MODE: RETRO TERMINAL VIBES
   ============================================ */

:root {
  /* Matrix-inspired color scheme */
  --neo-bg-primary: #0a0a0a;
  --neo-bg-secondary: #111111;
  --neo-bg-tertiary: #1a1a1a;
  --neo-bg-card: #0d0d0d;
  
  /* Neon green text - pure 90s hacker aesthetic */
  --neo-text-primary: #00ff41;
  --neo-text-secondary: #00cc33;
  --neo-text-muted: #008f11;
  --neo-text-inverse: #000000;
  
  /* Hot pink accents because why not */
  --neo-accent: #ff00ff;
  --neo-accent-hover: #ff66ff;
  --neo-accent-soft: rgba(255, 0, 255, 0.2);
  
  /* Borders with that CRT glow */
  --neo-border-color: #00ff41;
  --neo-border-width: 2px;
  --neo-border-style: solid;
  --neo-shadow-sm: 0 0 5px rgba(0, 255, 65, 0.3);
  --neo-shadow-md: 0 0 15px rgba(0, 255, 65, 0.4);
  --neo-shadow-lg: 0 0 30px rgba(0, 255, 65, 0.5);
  
  /* Typography - Courier for that terminal feel */
  --neo-font-family: 'Courier New', 'Lucida Console', Monaco, monospace;
  --neo-font-mono: 'Courier New', monospace;
  
  /* Cool cursor */
  --neo-cursor: crosshair;
  
  /* The legendary glow effect */
  --neo-glow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ff;
  
  /* Starfield background */
  --neo-bg-image: radial-gradient(ellipse at bottom, #1B2838 0%, #090a0f 100%);
}

/* Glowing text effect for headings */
.neo-heading, h1, h2, h3 {
  text-shadow: 0 0 10px #00ff41, 0 0 20px #00ff41, 0 0 30px #00ff41;
}

/* Pulsing glow on cards */
.neo-card {
  animation: card-glow 2s ease-in-out infinite alternate;
  box-shadow: 0 0 5px #00ff41, inset 0 0 5px rgba(0, 255, 65, 0.1);
}

@keyframes card-glow {
  from {
    box-shadow: 0 0 5px #00ff41, 0 0 10px #00ff41, inset 0 0 5px rgba(0, 255, 65, 0.1);
  }
  to {
    box-shadow: 0 0 10px #00ff41, 0 0 20px #00ff41, 0 0 30px #00ff41, inset 0 0 10px rgba(0, 255, 65, 0.2);
  }
}

/* Scanline effect enhancement */
body::after {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10000;
  background: linear-gradient(
    transparent 50%,
    rgba(0, 0, 0, 0.05) 50%
  );
  background-size: 100% 4px;
  animation: scanline 0.5s linear infinite;
}

@keyframes scanline {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(4px);
  }
}

/* Rainbow border animation */
.neo-btn--primary {
  background: linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3);
  background-size: 400% 400%;
  animation: rainbow 3s ease infinite;
  color: #000;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 2px;
}

@keyframes rainbow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* Typing cursor effect on inputs */
.neo-input {
  background-color: #000;
  color: #00ff41;
  border: 2px solid #00ff41;
  caret-color: #00ff41;
}

.neo-input:focus {
  box-shadow: 0 0 15px rgba(0, 255, 65, 0.5), inset 0 0 5px rgba(0, 255, 65, 0.1);
}

/* Avatar glow */
.neo-avatar {
  border-color: #ff00ff;
  box-shadow: 0 0 10px #ff00ff;
}

/* Links with that Y2K energy */
a {
  color: #00ffff;
  text-decoration: underline;
  text-shadow: 0 0 5px #00ffff;
}

a:hover {
  color: #ff00ff;
  text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff;
}
`

/**
 * Alternative Chaos Theme: Vaporwave Aesthetic
 */
const VAPORWAVE_CHAOS_CSS = `
:root {
  --neo-bg-primary: linear-gradient(180deg, #1a0533 0%, #4a1942 50%, #1a0533 100%);
  --neo-bg-secondary: rgba(255, 113, 206, 0.1);
  --neo-bg-tertiary: rgba(1, 205, 254, 0.1);
  --neo-bg-card: rgba(0, 0, 0, 0.7);
  
  --neo-text-primary: #ff71ce;
  --neo-text-secondary: #01cdfe;
  --neo-text-muted: #b967ff;
  
  --neo-accent: #fffb96;
  --neo-accent-hover: #05ffa1;
  
  --neo-font-family: 'Times New Roman', serif;
  --neo-border-color: #b967ff;
  --neo-cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ctext y='20' font-size='20'%3E🌴%3C/text%3E%3C/svg%3E"), auto;
}
`

export function useMockData() {
  /**
   * Current authenticated user
   */
  const currentUser: MockUser = {
    id: '1',
    username: 'chaos_queen',
    displayName: '✨ xXx_Ch40s_Qu33n_xXx ✨',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=chaos',
    header: 'https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&h=400&fit=crop',
    bio: '🌈 Living my best chaotic life | 🎮 Gamer | 💜 Certified Myspace Veteran | Top 8 material only',
    followersCount: 1337,
    followingCount: 420,
    postsCount: 9001,
    customCSS: RETRO_CHAOS_CSS
  }

  /**
   * Mock feed posts
   */
  const feedPosts: MockPost[] = [
    {
      id: '1',
      author: currentUser,
      content: `<p>just switched to Chaos Mode and my eyes are bleeding (in a good way) 👁️✨</p>
<p>this is giving 2006 energy and i'm HERE for it</p>`,
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      reblogsCount: 42,
      favouritesCount: 169,
      repliesCount: 7,
      mediaAttachments: []
    },
    {
      id: '2',
      author: {
        id: '2',
        username: 'normie_nina',
        displayName: 'Nina (she/her)',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=nina',
        header: '',
        bio: 'Just a normal person using normal mode.',
        followersCount: 234,
        followingCount: 567,
        postsCount: 89,
        customCSS: ''
      },
      content: `<p>I prefer Mom Mode tbh. It's clean and I can actually read things 😅</p>
<p>No shade to the chaos lovers but my eyes thank me</p>`,
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      reblogsCount: 12,
      favouritesCount: 45,
      repliesCount: 3,
      mediaAttachments: []
    },
    {
      id: '3',
      author: {
        id: '3',
        username: 'retro_revival',
        displayName: '🕹️ RetroRevival2005 🕹️',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=retro',
        header: '',
        bio: 'Bringing back the glory days of the internet',
        followersCount: 8088,
        followingCount: 1999,
        postsCount: 2005,
        customCSS: VAPORWAVE_CHAOS_CSS
      },
      content: `<p>Remember when everyone had a different background song on their profile?</p>
<p>NeoSpace is giving me those vibes and I'm not crying you're crying 😭</p>
<p>Petition to add autoplay MIDI files next</p>`,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      reblogsCount: 89,
      favouritesCount: 234,
      repliesCount: 45,
      mediaAttachments: []
    },
    {
      id: '4',
      author: currentUser,
      content: `<p>Pro tip: You can customize your Chaos Mode CSS in your profile metadata!</p>
<p>Go full custom. Make it cursed. This is a judgment-free zone 🌀</p>`,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      reblogsCount: 156,
      favouritesCount: 420,
      repliesCount: 23,
      mediaAttachments: []
    },
    {
      id: '5',
      author: {
        id: '4',
        username: 'css_crimes',
        displayName: '⚠️ CSS Crimes Enjoyer ⚠️',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=crimes',
        header: '',
        bio: 'If CSS was a crime, I would be on death row',
        followersCount: 6969,
        followingCount: 420,
        postsCount: 1337,
        customCSS: ''
      },
      content: `<p>Just added <code>* { animation: spin 1s infinite; }</code> to my Chaos Mode CSS</p>
<p>I regret nothing</p>
<p>okay maybe I regret it a little 🤢</p>`,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      reblogsCount: 234,
      favouritesCount: 567,
      repliesCount: 89,
      mediaAttachments: []
    }
  ]

  /**
   * Get the retro chaos CSS for testing
   */
  const getChaosCSS = () => RETRO_CHAOS_CSS

  /**
   * Get vaporwave CSS alternative
   */
  const getVaporwaveCSS = () => VAPORWAVE_CHAOS_CSS

  return {
    currentUser,
    feedPosts,
    getChaosCSS,
    getVaporwaveCSS
  }
}

