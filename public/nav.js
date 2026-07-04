// Navigation: hamburger toggle + click-to-open dropdowns (all screen sizes).
// Dropdowns open on click and stay open until you click the toggle again,
// pick a link, or click anywhere else on the page.
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('header nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
  }

  document.querySelectorAll('.dropdown-toggle').forEach(function (dt) {
    dt.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var dd = dt.parentElement;
      var wasOpen = dd.classList.contains('open');
      // close any other open dropdown first
      document.querySelectorAll('.dropdown.open').forEach(function (o) { o.classList.remove('open'); });
      if (!wasOpen) dd.classList.add('open');
    });
  });

  // click outside closes all dropdowns
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach(function (o) { o.classList.remove('open'); });
    }
  });
});
