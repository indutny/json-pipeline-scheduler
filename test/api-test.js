'use strict';

var assertText = require('assert-text');
var pipeline = require('json-pipeline');

var scheduler = require('../');
var fixtures = require('./fixtures');

assertText.options.trim = true;

describe('JSON Pipeline Scheduler', function() {
  fixtures.test('example from Click\'s thesis', function(p) {
    var start = p.add('start');
    var body = p.add('region');
    var exit = p.add('region');

    var i0 = p.add('literal').addLiteral(0);
    var a = p.add('read()');

    var phi = p.add('ssa:phi').addInput(i0).setControl(body);
    var one = p.add('literal').addLiteral(1);
    var addOne = p.add('add', [ a, one ]);
    var i2 = p.add('add', [ phi, addOne ]);
    phi.addInput(i2);

    var ten = p.add('literal').addLiteral(10);
    var cc = p.add('le', [ i2, ten ]);
    var branch = p.add('if', cc).setControl(body);

    body.setControl(start, branch);

    var two = p.add('literal').addLiteral(2);
    var mul = p.add('mul', [ i2, two ]);

    exit.setControl(branch);
    var ret = p.add('return', mul).setControl(exit);
  }, function() {/*
    pipeline {
      b0 {
        i0 = literal 0
        i1 = read()
        i2 = literal 1
        i3 = add i1, i2
        i4 = literal 10
        i5 = literal 2
        i6 = jump ^b0
      }
      b0 -> b1
      b0 => b1
      b1 {
        i7 = ssa:phi ^b1, i0, i8
        i8 = add i7, i3
        i9 = le i8, i4
        i10 = if ^b1, i9
      }
      b1 -> b1, b2
      b1 => b2
      b1 ~> b1
      b2 {
        i11 = mul i8, i5
        i12 = return ^b2, i11
      }
    }
  */});

  fixtures.test('merge/branch', function(p) {
    var start = p.add('start');
    var t = p.add('literal').addLiteral(true);
    var branch = p.add('if', t).setControl(start);

    var left = p.add('region').setControl(branch);

    var leftValue = p.add('literal').addLiteral('left');

    var right = p.add('region').setControl(branch);

    var rightValue = p.add('literal').addLiteral('right');

    var merge = p.add('region').setControl(left, right);
    var phi = p.add('ssa:phi', [ leftValue, rightValue ]).setControl(merge);
    var ret = p.add('return', phi).setControl(merge);
  }, function() {/*
    pipeline {
      b0 {
        i0 = literal true
        i1 = literal "left"
        i2 = literal "right"
        i3 = if ^b0, i0
      }
      b0 -> b1, b2
      b0 => b3, b1, b2
      b1 {
        i4 = jump ^b1
      }
      b1 -> b3
      b1 ~> b3
      b2 {
        i5 = jump ^b2
      }
      b2 -> b3
      b2 ~> b3
      b3 {
        i6 = ssa:phi ^b3, i1, i2
        i7 = return ^b3, i6
      }
    }
  */});

  fixtures.test('store and load', function(p) {
    var start = p.add('start');
    var t = p.add('literal').addLiteral(true);
    var branch = p.add('if', t).setControl(start);

    var left = p.add('region').setControl(branch);

    var leftValue = p.add('literal').addLiteral('left');

    var right = p.add('region').setControl(branch);

    var rightValue = p.add('literal').addLiteral('right');

    var merge = p.add('region').setControl(left, right);
    var phi = p.add('ssa:phi', [ leftValue, rightValue ]).setControl(merge);
    var ret = p.add('return', phi).setControl(merge);
  }, function() {/*
    pipeline {
      b0 {
        i0 = literal true
        i1 = literal "left"
        i2 = literal "right"
        i3 = if ^b0, i0
      }
      b0 -> b1, b2
      b0 => b3, b1, b2
      b1 {
        i4 = jump ^b1
      }
      b1 -> b3
      b1 ~> b3
      b2 {
        i5 = jump ^b2
      }
      b2 -> b3
      b2 ~> b3
      b3 {
        i6 = ssa:phi ^b3, i1, i2
        i7 = return ^b3, i6
      }
    }
  */});

  fixtures.test('single block node order', function(p) {
    var start = p.add('start');
    var ret = p.add('return').setControl(start);
    var one = p.add('literal').addLiteral(1);
    var add = p.add('add').addInput(one);
    var two = p.add('literal').addLiteral(2);
    add.addInput(two);
    ret.addInput(add);
  }, function() {/*
    pipeline {
      b0 {
        i0 = literal 1
        i1 = literal 2
        i2 = add i0, i1
        i3 = return ^b0, i2
      }
    }
  */});
});
