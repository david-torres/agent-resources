window.CharacterClassOutdated = (function () {
  const init = () => {
    const classSelect = document.getElementById('char-class-id');
    const checkbox = document.getElementById('char-show-outdated-classes');
    if (!classSelect || !checkbox) return;
    if (classSelect.dataset.outdatedInit === 'true') return;
    classSelect.dataset.outdatedInit = 'true';

    const isHeader = (opt) => opt.disabled && !opt.hasAttribute('value');
    const selectedOption = () => classSelect.options[classSelect.selectedIndex];
    let protectedOption = [...classSelect.options].find((opt) => opt.defaultSelected) || null;
    classSelect.addEventListener('change', () => { protectedOption = selectedOption() || null; });

    const apply = () => {
      const options = [...classSelect.children].filter((el) => el.tagName === 'OPTION');
      const headers = new Set(options.filter(isHeader));
      options.forEach((opt) => {
        if (headers.has(opt) || !opt.hasAttribute('data-outdated')) return;
        const hide = !checkbox.checked && opt !== protectedOption;
        opt.hidden = hide;
        opt.disabled = hide;
      });
      let header = null;
      let allHidden = true;
      const closeGroup = () => { if (header) header.hidden = allHidden; };
      options.forEach((opt) => {
        if (headers.has(opt)) {
          closeGroup();
          header = opt;
          allHidden = true;
        } else if (!opt.hidden) {
          allHidden = false;
        }
      });
      closeGroup();
      const current = selectedOption();
      if (current && current.hidden) {
        const firstVisible = options.find((opt) => !opt.hidden && !opt.disabled && !headers.has(opt));
        if (firstVisible) {
          classSelect.value = firstVisible.value;
          classSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
        }
      }
    };

    checkbox.checked = !!(protectedOption && protectedOption.hasAttribute('data-outdated'));
    checkbox.addEventListener('change', apply);
    apply();
  };

  init();
  return { init };
})();
