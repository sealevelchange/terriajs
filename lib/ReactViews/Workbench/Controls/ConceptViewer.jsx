'use strict';

import ObserveModelMixin from '../../ObserveModelMixin';
import React from 'react';
import Icon from "../../Icon.jsx";
import classNames from 'classnames';

import Styles from './concept-viewer.scss';

const ConceptViewer = React.createClass({
    mixins: [ObserveModelMixin],

    propTypes: {
        item: React.PropTypes.object.isRequired
    },

    render() {
        return (
            <div className={Styles.root}>
                <For each="concept" index="i"
                     of={this.props.item.concepts.filter(concept => concept.isVisible)}>
                    <div className={Styles.inner} key={i}>
                        <ul className={Styles.childrenList}>
                            <Concept concept={concept}/>
                        </ul>
                    </div>
                </For>
            </div>
        );
    }
});

const Concept = React.createClass({
    mixins: [ObserveModelMixin],

    propTypes: {
        concept: React.PropTypes.object.isRequired,
        allowMultiple: React.PropTypes.bool
    },

    toggleOpen() {
        this.props.concept.toggleOpen();
    },

    toggleActive() {
        this.props.concept.toggleActive();
    },

    getColorStyle() {
        if (this.props.concept.color) {
            return {color: this.props.concept.color};
        }
    },

    render() {
        const concept = this.props.concept;

        return (
            <li style={this.getColorStyle()}>
                <If condition={concept.name}>
                    <div className={classNames(Styles.header, {[Styles.hasChildren]: concept.hasChildren})}>
                        <If condition={concept.hasChildren}>
                            <button type='button'
                                    onClick={this.toggleOpen}
                                    style={this.getColorStyle()}
                                    className={Styles.btn}
                                    title='open variable selection'>
                                    {concept.isOpen ? <Icon glyph={Icon.GLYPHS.opened}/> : <Icon glyph={Icon.GLYPHS.closed}/>}
                            </button>
                        </If>
                        <If condition={concept.isSelectable}>
                            <button type='button'
                                    onClick={this.toggleActive}
                                    style={this.getColorStyle()}
                                    className={Styles.btn}
                                    title='select variable'>
                                    {(concept.isActive && this.props.allowMultiple) && <Icon glyph={Icon.GLYPHS.checkboxOn}/>}
                                    {(!concept.isActive && this.props.allowMultiple) && <Icon glyph={Icon.GLYPHS.checkboxOff}/>}
                                    {(concept.isActive && !this.props.allowMultiple) && <Icon glyph={Icon.GLYPHS.radioOn}/>}
                                    {(!concept.isActive && !this.props.allowMultiple) && <Icon glyph={Icon.GLYPHS.radioOff}/>}
                            </button>
                        </If>
                        {concept.name}
                    </div>
                </If>
                <If condition={concept.isOpen}>
                    <ul className={Styles.items}>
                        <For each="child" index="i" of={concept.items.filter(concept => concept.isVisible)}>
                            <Concept key={i} concept={child} allowMultiple={concept.allowMultiple}/>
                        </For>
                    </ul>
                </If>
            </li>
        );
    }
});

module.exports = ConceptViewer;
