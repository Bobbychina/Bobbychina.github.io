/* ===========================================================
   资源层：把 base64 内嵌的 PNG 解码成可绘制的 Image，
   并在加载完成后生成"纯白剪影"副本，用于受击闪光。

   设计要点：
   - 全部图片来自 VS.SpriteData 里的 data:image/png;base64，
     没有任何外部文件或网络请求，file:// 双击即可用。
   - data URI 是异步解码的，所以这里不做阻塞等待：
     渲染层通过 isReady() 判断，没就绪时退回简单形状，
     开局面板停留的这段时间足够全部解码完成。
   - 在无 DOM 环境（Node 无头测试）里 init() 直接返回 false，
     渲染层自动降级，不影响逻辑测试。
   =========================================================== */
(function (VS) {
  'use strict';

  var images = Object.create(null);       // name -> Image
  var silhouettes = Object.create(null);  // name -> canvas（白色剪影）
  var total = 0;
  var loaded = 0;
  var supported = false;

  function makeCanvas(w, h) {
    try {
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    } catch (e) {
      return null;
    }
  }

  /** 生成白色剪影：先画原图，再用 source-in 把非透明像素整体染白 */
  function buildSilhouette(name, img) {
    try {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) return;

      var c = makeCanvas(w, h);
      if (!c) return;
      var g = c.getContext('2d');
      if (!g) return;

      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';

      silhouettes[name] = c;
    } catch (e) {
      /* 剪影失败不影响正常绘制 */
    }
  }

  function startLoad(name, def) {
    var img = new Image();

    img.onload = function () {
      loaded++;
      buildSilhouette(name, img);
    };
    img.onerror = function () {
      loaded++;
    };

    images[name] = img;

    try {
      img.src = def.uri;
    } catch (e) {
      loaded++;
    }
  }

  var Assets = {

    /**
     * 开始加载图集。返回是否真的启动了加载。
     * 无 Image / 无 SpriteData 时返回 false，调用方应降级。
     */
    init: function () {
      if (typeof Image === 'undefined' || !VS.SpriteData) {
        supported = false;
        return false;
      }

      var names = Object.keys(VS.SpriteData);
      total = names.length;
      loaded = 0;

      for (var i = 0; i < names.length; i++) {
        startLoad(names[i], VS.SpriteData[names[i]]);
      }

      supported = true;
      return true;
    },

    supported: function () { return supported; },

    /** 取一张图；不存在返回 null */
    img: function (name) {
      return images[name] || null;
    },

    /** 取受击闪光用的白色剪影 */
    white: function (name) {
      return silhouettes[name] || null;
    },

    /** 图片是否已经可以绘制 */
    isReady: function (img) {
      if (!img) return false;
      var w = img.naturalWidth || img.width;
      return !!(img.complete && w > 0);
    },

    /** 是否已就绪（直接按名字判断） */
    ready: function (name) {
      return Assets.isReady(images[name]);
    },

    /** 加载进度 0..1，可用于加载提示 */
    progress: function () {
      return total > 0 ? loaded / total : 1;
    },

    loadedCount: function () { return loaded; },
    totalCount: function () { return total; },

    /**
     * 按时间从动画组里取当前帧名
     * @param {string} group 组名（VS.SpriteGroups 的键）
     * @param {number} t 累计时间（秒）
     * @param {number} fps 播放速度（帧/秒）
     * @param {number} [offset] 相位偏移，让同类怪物不同步
     */
    frameAt: function (group, t, fps, offset) {
      var list = VS.SpriteGroups[group];
      if (!list || !list.length) return null;
      var phase = (t + (offset || 0)) * (fps || 6);
      var i = Math.floor(phase) % list.length;
      if (i < 0) i += list.length;
      return list[i];
    },

    /** 组里一共有几帧 */
    frameCount: function (group) {
      var list = VS.SpriteGroups[group];
      return list ? list.length : 0;
    },

    /**
     * 组是否全部就绪
     */
    groupReady: function (group) {
      var list = VS.SpriteGroups[group];
      if (!list || !list.length) return false;
      for (var i = 0; i < list.length; i++) {
        if (!Assets.isReady(images[list[i]])) return false;
      }
      return true;
    },

    /** 全部图集是否就绪 */
    allReady: function () {
      return total > 0 && loaded >= total;
    },

    /** 供调试：已加载的图名 */
    names: function () {
      return Object.keys(images);
    }
  };

  VS.register('Assets', Assets);

})(window.VS = window.VS || {});
