// Tinylytics, on the production host only (never a preview or the CloudFront
// domain). The deploy build adds this script once a site id is set.
(function () {
  var me = document.currentScript;
  if (!me || location.hostname !== me.dataset.host) return;
  var s = document.createElement("script");
  s.defer = true;
  s.src = me.dataset.src;
  s.dataset.site = me.dataset.site;
  document.body.append(s);
})();
