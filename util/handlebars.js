// N times helper, usage: {{#times 5}}<div>{{index}}</div>{{/times}}
// https://stackoverflow.com/a/41463316
const times = function (n, block) {
    var accum = '';
    for (var i = 0; i < n; ++i) {
        block.data.index = i;
        block.data.first = i === 0;
        block.data.last = i === (n - 1);
        accum += block.fn(this);
    }
    return accum;
};

module.exports = {
    times
}