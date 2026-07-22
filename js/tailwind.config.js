// Tailwind 浏览器版配置。
// 品牌色和应用字体放在这里。
tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Google Sans"', 'Roboto', 'sans-serif'],
                        mono: ['"Roboto Mono"', 'monospace'],
                    },
                    colors: {
                        googleBlue: '#1a73e8', googleRed: '#ea4335', googleYellow: '#fbbc04', googleGreen: '#34a853',
                        googlePurple: '#9334e6',
                        darkSurface: '#303134', darkBg: '#202124', darkBorder: '#5f6368', darkText: '#e8eaed', darkTextSec: '#9aa0a6',
                        stockRed: '#f04a4a', stockRedBg: '#fef1f1', stockGreen: '#0fa968', stockGreenBg: '#ecfdf5',
                    }
                }
            }
        };

// app.js 在 body 末尾执行；DOMContentLoaded 时再插入云端数据加载补丁，确保它覆盖 app.js 的启动和同步逻辑。
document.addEventListener('DOMContentLoaded', () => {
    const script = document.createElement('script');
    script.src = 'js/cloud-loader.js?v=20260722-dd-edge-align';
    document.body.appendChild(script);
});
