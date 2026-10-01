(() => {
  const setup = () => {
    const edition = document.getElementById('class-rules-edition');
    const version = document.getElementById('class-rules-version');
    if (!edition || !version) return;
    const update = () => {
      const aspirant = edition.value === 'aspirant';
      const v2 = version.querySelector('option[value="v2"]');
      if (v2) v2.disabled = aspirant;
      if (aspirant) version.value = 'v1';
    };
    edition.onchange = update;
    update();
  };
  document.addEventListener('DOMContentLoaded', setup);
  document.addEventListener('htmx:load', setup);
  setup();
})();
