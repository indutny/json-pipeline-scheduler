'use strict';

var assertText = require('assert-text');
var pipeline = require('json-pipeline');

var scheduler = require('../');

assertText.options.trim = true;

exports.fn2str = function fn2str(fn) {
  return fn.toString().replace(/^function[^{]+{\/\*|\*\/}$/g, '');
};

exports.test = function test(name, body, expected) {
  it('should pass on ' + name, function() {
    var p = pipeline.create();

    body(p);

    var s = scheduler.create(p);
    var out = s.run();

    out.reindex();
    var actual = out.render({ cfg: true, dominance: true }, 'printable');
    assertText.equal(actual, exports.fn2str(expected));
  });
};
